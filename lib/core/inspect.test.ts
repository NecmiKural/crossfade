import { describe, expect, it } from "vitest";
import { extractAppConfig, redactSecrets } from "@/lib/core/inspect";

const token = "a1".repeat(32);

describe("redactSecrets", () => {
  it("removes every 64-hex secret from rendered config", () => {
    const routes = JSON.stringify([{ routes: [{ match: { headers: [{ name: "x-crossfade-tester", string_match: { exact: token } }] } }] }]);
    const redacted = redactSecrets(routes);
    expect(redacted).not.toMatch(/[0-9a-f]{64}/);
    expect(redacted).toContain("‹redacted›");
  });

  it("keeps everything else intact", () => {
    const clusters = JSON.stringify([{ name: "shop--v1", port_value: 3000, version: "1791688811129" }]);
    expect(redactSecrets(clusters)).toBe(clusters);
  });
});

describe("extractAppConfig", () => {
  const clusters = JSON.stringify([{ name: "api--blue" }, { name: "shop--v1" }, { name: "shop--v2" }, { name: "shopx--v1" }]);
  const routes = JSON.stringify([
    {
      name: "edge",
      virtual_hosts: [
        { name: "localhost", domains: ["localhost"], routes: [{ name: "api" }, { name: "shop.tester" }, { name: "shop" }] },
        { name: "fallback", domains: ["*"], routes: [{ name: "no-app" }] },
      ],
    },
  ]);

  it("returns only the app's own clusters and routes, tester route included", () => {
    const config = extractAppConfig({ clustersJson: clusters, routesJson: routes, app: "shop", domain: "localhost" });
    expect(config.clusters.map((c) => (c as { name: string }).name)).toEqual(["shop--v1", "shop--v2"]);
    expect(config.routes.map((r) => (r as { name: string }).name)).toEqual(["shop.tester", "shop"]);
  });

  it("is empty when the app is not in the snapshot", () => {
    expect(extractAppConfig({ clustersJson: clusters, routesJson: routes, app: "blog", domain: "blog.localhost" })).toEqual({ clusters: [], routes: [] });
  });
});
