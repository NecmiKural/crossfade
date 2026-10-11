import { describe, expect, it } from "vitest";
import { fixtureJson, staticBootstrap } from "@/tests/helpers/bootstrap";
import { renderClusters, renderRoutes } from "@/lib/xds/render";
import type { RenderApp, RenderContext } from "@/lib/xds/types";

const shop: RenderApp = {
  slug: "shop",
  domain: "localhost",
  pathPrefix: "/",
  stableVersion: "v1",
  sticky: true,
  testerToken: "tttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt",
  release: null,
  versions: [
    { name: "v2", host: "shop-v2", port: 3000, healthPath: "/healthz" },
    { name: "v1", host: "shop-v1", port: 3000, healthPath: "/healthz" },
  ],
};
const api: RenderApp = {
  slug: "api",
  domain: "localhost",
  pathPrefix: "/api",
  stableVersion: "blue",
  sticky: true,
  testerToken: "tttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt",
  release: null,
  versions: [{ name: "blue", host: "api-blue", port: 8080, healthPath: "/status" }],
};
const blog: RenderApp = {
  slug: "blog",
  domain: "blog.example.com",
  pathPrefix: "/",
  stableVersion: null,
  sticky: true,
  testerToken: "tttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt",
  release: null,
  versions: [],
};

const ctx: RenderContext = { apps: [shop, api, blog] };

describe("renderClusters", () => {
  it("renders one health-checked STRICT_DNS cluster per version, sorted by name", () => {
    const clusters = renderClusters(ctx);
    expect(clusters.map((c) => c.name)).toEqual(["api--blue", "shop--v1", "shop--v2"]);
    expect(clusters[1]).toMatchObject({
      "@type": "type.googleapis.com/envoy.config.cluster.v3.Cluster",
      type: "STRICT_DNS",
      load_assignment: {
        cluster_name: "shop--v1",
        endpoints: [{ lb_endpoints: [{ endpoint: { address: { socket_address: { address: "shop-v1", port_value: 3000 } } } }] }],
      },
      health_checks: [
        {
          no_traffic_interval: "5s",
          http_health_check: { path: "/healthz", host: "localhost" },
        },
      ],
    });
  });

  it("keeps upstream keep-alive below Node's 5 s default", () => {
    const options = renderClusters(ctx)[0].typed_extension_protocol_options as Record<string, { common_http_protocol_options: unknown }>;
    expect(Object.values(options)[0].common_http_protocol_options).toEqual({ idle_timeout: "4s" });
  });
});

describe("renderRoutes", () => {
  const routes = renderRoutes(ctx);
  const vhosts = routes.virtual_hosts as Array<{ name: string; domains: string[]; routes: Array<Record<string, unknown>> }>;

  it("names the config edge and sorts virtual hosts by domain with the fallback last", () => {
    expect(routes.name).toBe("edge");
    expect(vhosts.map((v) => v.name)).toEqual(["blog.example.com", "localhost", "fallback"]);
    expect(vhosts[2]).toMatchObject({
      domains: ["*"],
      routes: [{ direct_response: { status: 404, body: { inline_string: "crossfade: no app for this host\n" } } }],
    });
  });

  it("puts longer prefixes first and uses path_separated_prefix except for the root", () => {
    const localhost = vhosts[1];
    expect(localhost.routes.map((r) => r.name)).toEqual(["api", "shop"]);
    expect(localhost.routes[0].match).toEqual({ path_separated_prefix: "/api" });
    expect(localhost.routes[1].match).toEqual({ prefix: "/" });
  });

  it("routes to the stable cluster with a 60 s timeout and no retries", () => {
    expect(vhosts[1].routes[1].route).toEqual({ cluster: "shop--v1", timeout: "60s" });
  });

  it("answers 503 for an app without a stable version", () => {
    expect(vhosts[0].routes[0]).toMatchObject({ name: "blog", direct_response: { status: 503 } });
  });

  it("is deterministic regardless of input order", () => {
    const shuffled: RenderContext = { apps: [blog, { ...shop, versions: [...shop.versions].reverse() }, api] };
    expect(JSON.stringify(renderRoutes(shuffled))).toBe(JSON.stringify(routes));
    expect(JSON.stringify(renderClusters(shuffled))).toBe(JSON.stringify(renderClusters(ctx)));
  });
});

describe("releases", () => {
  const v2Rolling = (weight: number, sticky = true): RenderContext => ({
    apps: [{ ...shop, sticky, release: { status: "rolling", candidate: "v2", weight } }],
  });
  const mainRoute = (c: RenderContext) =>
    (renderRoutes(c).virtual_hosts as Array<{ routes: Array<Record<string, unknown>> }>)[0].routes.find((r) => r.name === "shop");

  it("splits traffic [100-w, w] and hashes the leftmost X-Forwarded-For when sticky", () => {
    expect(mainRoute(v2Rolling(10))?.route).toEqual({
      weighted_clusters: {
        clusters: [
          { name: "shop--v1", weight: 90 },
          { name: "shop--v2", weight: 10 },
        ],
        use_hash_policy: true,
      },
      timeout: "60s",
      hash_policy: [
        { header: { header_name: "x-forwarded-for", regex_rewrite: { pattern: { regex: "^\\s*([^,\\s]+).*$" }, substitution: "\\1" } } },
      ],
    });
  });

  it("splits per request when the app is not sticky", () => {
    const route = mainRoute(v2Rolling(50, false))?.route as Record<string, unknown>;
    expect(route.hash_policy).toBeUndefined();
    expect(route.weighted_clusters).toEqual({
      clusters: [
        { name: "shop--v1", weight: 50 },
        { name: "shop--v2", weight: 50 },
      ],
    });
  });

  it("keeps the plain stable route at weight 0 and while paused at 0", () => {
    expect(mainRoute(v2Rolling(0))?.route).toEqual({ cluster: "shop--v1", timeout: "60s" });
    const paused: RenderContext = { apps: [{ ...shop, release: { status: "paused", candidate: "v2", weight: 50 } }] };
    expect((mainRoute(paused)?.route as Record<string, unknown>).weighted_clusters).toBeDefined();
  });

  it.each(["pending_approval", "warming"] as const)("adds the tester route ahead of the main route while %s", (status) => {
    const c: RenderContext = { apps: [{ ...shop, release: { status, candidate: "v2", weight: 0 } }] };
    const routes = (renderRoutes(c).virtual_hosts as Array<{ routes: Array<Record<string, unknown>> }>)[0].routes;
    expect(routes.map((r) => r.name)).toEqual(["shop.tester", "shop"]);
    expect(routes[0]).toEqual({
      name: "shop.tester",
      match: { prefix: "/", headers: [{ name: "x-crossfade-tester", string_match: { exact: "t".repeat(64) } }] },
      route: { cluster: "shop--v2", timeout: "60s" },
      request_headers_to_remove: ["x-crossfade-tester"],
    });
  });

  it.each(["rolling", "paused", "promoted", "rolled_back", "cancelled"] as const)("has no tester route while %s", (status) => {
    const c: RenderContext = { apps: [{ ...shop, release: { status, candidate: "v2", weight: 10 } }] };
    const routes = (renderRoutes(c).virtual_hosts as Array<{ routes: Array<Record<string, unknown>> }>)[0].routes;
    expect(routes.map((r) => r.name)).toEqual(["shop"]);
  });
});

describe("Envoy fixtures", () => {
  it("stable-only bootstrap", async () => {
    await expect(fixtureJson(staticBootstrap(renderClusters(ctx), renderRoutes(ctx)))).toMatchFileSnapshot(
      "../../envoy/fixtures/stable.json",
    );
  });

  it.each([
    ["warming", { status: "warming", candidate: "v2", weight: 0 }, true],
    ["rolling-sticky", { status: "rolling", candidate: "v2", weight: 10 }, true],
    ["rolling-random", { status: "rolling", candidate: "v2", weight: 50 }, false],
  ] as const)("%s bootstrap", async (name, release, sticky) => {
    const c: RenderContext = { apps: [{ ...shop, sticky, release }, api] };
    await expect(fixtureJson(staticBootstrap(renderClusters(c), renderRoutes(c)))).toMatchFileSnapshot(
      `../../envoy/fixtures/${name}.json`,
    );
  });

  it("empty bootstrap", async () => {
    const empty: RenderContext = { apps: [] };
    await expect(fixtureJson(staticBootstrap(renderClusters(empty), renderRoutes(empty)))).toMatchFileSnapshot(
      "../../envoy/fixtures/empty.json",
    );
  });
});
