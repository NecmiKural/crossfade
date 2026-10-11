import { describe, expect, it } from "vitest";
import { renderClusters, renderRoutes } from "@/lib/xds/render";
import type { EnvoyResource, RenderContext } from "@/lib/xds/types";
import { validateSnapshot } from "@/lib/xds/validate";

const ctx: RenderContext = {
  apps: [
    {
      slug: "shop",
      domain: "localhost",
      pathPrefix: "/",
      stableVersion: "v1",
      versions: [
        { name: "v1", host: "shop-v1", port: 3000, healthPath: "/healthz" },
        { name: "v2", host: "shop-v2", port: 3000, healthPath: "/healthz" },
      ],
    },
    {
      slug: "api",
      domain: "localhost",
      pathPrefix: "/api",
      stableVersion: "blue",
      versions: [{ name: "blue", host: "api-blue", port: 8080, healthPath: "/healthz" }],
    },
  ],
};

type Route = Record<string, unknown> & { name: string; match: Record<string, string>; route?: Record<string, unknown> };
type Vhost = { name: string; domains: string[]; routes: Route[] };

function fixture() {
  const clusters = renderClusters(ctx).map((c) => structuredClone(c) as Record<string, unknown> & EnvoyResource);
  const routes = structuredClone(renderRoutes(ctx)) as EnvoyResource & { virtual_hosts: Vhost[] };
  return { clusters, routes, localhost: routes.virtual_hosts[0] };
}

describe("validateSnapshot", () => {
  it("accepts what the renderers produce", () => {
    const { clusters, routes } = fixture();
    expect(validateSnapshot(clusters, routes)).toEqual([]);
  });

  it("rejects a route to an unknown cluster", () => {
    const f = fixture();
    f.localhost.routes[1].route = { cluster: "shop--v9", timeout: "60s" };
    expect(validateSnapshot(f.clusters, f.routes)).toContain('route "shop" references unknown cluster "shop--v9"');
  });

  it("rejects a route to another app's cluster", () => {
    const f = fixture();
    f.localhost.routes[1].route = { cluster: "api--blue", timeout: "60s" };
    expect(validateSnapshot(f.clusters, f.routes)).toContain('route "shop" references cluster "api--blue" of another app');
  });

  it("rejects reserved and malformed cluster names", () => {
    const f = fixture();
    f.clusters[0] = { ...f.clusters[0], name: "control-plane" };
    f.clusters[1] = { ...f.clusters[1], name: "shop-v1" };
    const problems = validateSnapshot(f.clusters, f.routes);
    expect(problems).toContain('cluster name "control-plane" is reserved');
    expect(problems).toContain('cluster name "shop-v1" is not <app>--<version>');
  });

  it("rejects duplicate cluster names", () => {
    const f = fixture();
    f.clusters.push(f.clusters[0]);
    expect(validateSnapshot(f.clusters, f.routes)).toContain('duplicate cluster "api--blue"');
  });

  it("rejects duplicate domains and a second wildcard", () => {
    const f = fixture();
    f.routes.virtual_hosts.push({ name: "dup", domains: ["localhost"], routes: [] });
    f.routes.virtual_hosts.push({ name: "star2", domains: ["*"], routes: [] });
    const problems = validateSnapshot(f.clusters, f.routes);
    expect(problems).toContain('domain "localhost" appears in more than one virtual host');
    expect(problems).toContain('domain "*" appears in more than one virtual host');
  });

  it("rejects a shorter prefix ahead of a longer one", () => {
    const f = fixture();
    f.localhost.routes.reverse();
    expect(validateSnapshot(f.clusters, f.routes)).toContain('virtual host "localhost": route "api" is shadowed by a shorter prefix before it');
  });

  it.each([
    ["one entry", [{ name: "shop--v1", weight: 100 }]],
    ["three entries", [{ name: "shop--v1", weight: 40 }, { name: "shop--v2", weight: 30 }, { name: "shop--v1", weight: 30 }]],
    ["a zero weight", [{ name: "shop--v1", weight: 100 }, { name: "shop--v2", weight: 0 }]],
    ["a bad sum", [{ name: "shop--v1", weight: 50 }, { name: "shop--v2", weight: 40 }]],
  ])("rejects weighted clusters with %s", (_name, clusters) => {
    const f = fixture();
    f.localhost.routes[1].route = { weighted_clusters: { clusters }, timeout: "60s" };
    expect(validateSnapshot(f.clusters, f.routes).some((p) => p.startsWith('route "shop" weighted clusters'))).toBe(true);
  });

  it("accepts a valid two-way split and checks each weighted cluster reference", () => {
    const f = fixture();
    f.localhost.routes[1].route = {
      weighted_clusters: { clusters: [{ name: "shop--v1", weight: 90 }, { name: "shop--v2", weight: 10 }] },
      timeout: "60s",
    };
    expect(validateSnapshot(f.clusters, f.routes)).toEqual([]);
    f.localhost.routes[1].route = {
      weighted_clusters: { clusters: [{ name: "shop--v1", weight: 90 }, { name: "shop--v7", weight: 10 }] },
    };
    expect(validateSnapshot(f.clusters, f.routes)).toContain('route "shop" references unknown cluster "shop--v7"');
  });

  it("treats tester routes as belonging to their app", () => {
    const f = fixture();
    f.localhost.routes.splice(1, 0, { name: "shop.tester", match: { prefix: "/" }, route: { cluster: "shop--v2" } });
    expect(validateSnapshot(f.clusters, f.routes)).toEqual([]);
  });
});
