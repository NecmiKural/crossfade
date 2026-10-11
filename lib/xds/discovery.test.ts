import { describe, expect, it } from "vitest";
import {
  discoveryResponse,
  EMPTY_SNAPSHOT,
  envoyVersion,
  parseDiscoveryRequest,
  parseVersion,
  resourceKind,
  tokenMatches,
} from "@/lib/xds/discovery";

// Shape of a real Envoy v1.39 REST DiscoveryRequest (proto field names preserved, extra fields present).
const envoyRequest = {
  version_info: "1791688811129",
  node: {
    id: "edge-1",
    cluster: "crossfade-edge",
    metadata: { xds_token: "secret-token" },
    user_agent_name: "envoy",
    user_agent_build_version: { version: { major_number: 1, minor_number: 39, patch: 3 }, metadata: {} },
    extensions: [{ name: "envoy.filters.http.router", category: "envoy.filters.http" }],
    client_features: ["envoy.lb.does_not_support_overprovisioning"],
  },
  resource_names: [],
  type_url: "type.googleapis.com/envoy.config.cluster.v3.Cluster",
};

describe("resourceKind", () => {
  it("maps the two discovery endpoints", () => {
    expect(resourceKind("discovery:clusters")).toBe("cds");
    expect(resourceKind("discovery:routes")).toBe("rds");
  });
  it.each(["discovery:listeners", "discovery:endpoints", "clusters", ""])("ignores %s", (segment) => {
    expect(resourceKind(segment)).toBeNull();
  });
});

describe("parseDiscoveryRequest", () => {
  it("accepts the real Envoy shape and drops fields it does not need", () => {
    const parsed = parseDiscoveryRequest(envoyRequest);
    expect(parsed).toEqual({
      ok: true,
      request: {
        versionInfo: "1791688811129",
        nodeId: "edge-1",
        token: "secret-token",
        envoyVersion: "1.39.3",
      },
    });
  });

  it("accepts the first poll without version_info", () => {
    const { version_info: _v, ...first } = envoyRequest;
    const parsed = parseDiscoveryRequest(first);
    expect(parsed.ok && parsed.request.versionInfo).toBeNull();
  });

  it.each([
    ["not an object", "nope"],
    ["missing node", { version_info: "1" }],
    ["unsafe node id", { node: { id: "edge 1; DROP" } }],
    ["huge version", { node: { id: "edge-1" }, version_info: "9".repeat(40) }],
  ])("rejects %s", (_name, body) => {
    expect(parseDiscoveryRequest(body).ok).toBe(false);
  });
});

describe("tokenMatches", () => {
  it("compares in constant time over digests", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abc", "abd")).toBe(false);
    expect(tokenMatches("abc", "abcd")).toBe(false);
    expect(tokenMatches("abc", null)).toBe(false);
  });
});

describe("parseVersion and envoyVersion", () => {
  it("parses numeric versions only", () => {
    expect(parseVersion("1791688811129")).toBe(1791688811129);
    expect(parseVersion("0")).toBe(0);
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion("abc")).toBeNull();
  });
  it("formats the build version message", () => {
    expect(envoyVersion({ version: { major_number: 1, minor_number: 40, patch: 0 } })).toBe("1.40.0");
    expect(envoyVersion(undefined)).toBeNull();
    expect(envoyVersion({ version: {} })).toBe("0.0.0");
  });
});

describe("discoveryResponse", () => {
  const snapshot = { cdsVersion: 100, rdsVersion: 200, clusters: '[{"@type":"x","name":"shop--v1"}]', routes: '[{"name":"edge"}]' };

  it("returns 304 when Envoy already has the current version", () => {
    expect(discoveryResponse("cds", snapshot, "100")).toEqual({ status: 304, servedVersion: 100 });
  });

  it("returns the precomputed resources verbatim otherwise", () => {
    const response = discoveryResponse("rds", snapshot, "199");
    expect(response.status).toBe(200);
    expect(response.servedVersion).toBe(200);
    expect(response.body).toBe(
      '{"version_info":"200","type_url":"type.googleapis.com/envoy.config.route.v3.RouteConfiguration","resources":[{"name":"edge"}]}',
    );
  });

  it("serves an empty config at version 0 before the first snapshot", () => {
    const response = discoveryResponse("cds", EMPTY_SNAPSHOT, null);
    expect(JSON.parse(response.body ?? "")).toEqual({
      version_info: "0",
      type_url: "type.googleapis.com/envoy.config.cluster.v3.Cluster",
      resources: [],
    });
    const routes = JSON.parse(discoveryResponse("rds", EMPTY_SNAPSHOT, null).body ?? "");
    expect(routes.resources[0].virtual_hosts.map((v: { name: string }) => v.name)).toEqual(["fallback"]);
  });
});
