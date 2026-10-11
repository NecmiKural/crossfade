import { describe, expect, it } from "vitest";
import { fixtureJson, staticBootstrap } from "@/tests/helpers/bootstrap";
import { renderClusters, renderRoutes } from "@/lib/xds/render";
import type { RenderApp, RenderContext } from "@/lib/xds/types";

const shop: RenderApp = {
  slug: "shop",
  domain: "localhost",
  pathPrefix: "/",
  stableVersion: "v1",
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
  versions: [{ name: "blue", host: "api-blue", port: 8080, healthPath: "/status" }],
};
const blog: RenderApp = {
  slug: "blog",
  domain: "blog.example.com",
  pathPrefix: "/",
  stableVersion: null,
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

describe("Envoy fixtures", () => {
  it("stable-only bootstrap", async () => {
    await expect(fixtureJson(staticBootstrap(renderClusters(ctx), renderRoutes(ctx)))).toMatchFileSnapshot(
      "../../envoy/fixtures/stable.json",
    );
  });

  it("empty bootstrap", async () => {
    const empty: RenderContext = { apps: [] };
    await expect(fixtureJson(staticBootstrap(renderClusters(empty), renderRoutes(empty)))).toMatchFileSnapshot(
      "../../envoy/fixtures/empty.json",
    );
  });
});
