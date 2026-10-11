import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clusterStats, parseStats, STATS_FILTER } from "@/lib/engine/stats";

const fixture: unknown = JSON.parse(readFileSync("tests/fixtures/envoy-stats.json", "utf8"));

describe("parseStats", () => {
  it("reads uptime and per-cluster counters from Envoy's JSON stats (captured from a live edge)", () => {
    const parsed = parseStats(fixture);
    expect(parsed?.uptimeSeconds).toBe(25);
    expect(clusterStats(parsed, "shop--v2")).toEqual({ completed: 61, errors: 17, healthy: 1 });
  });

  it("counts a missing 5xx counter as zero, because Envoy creates it on first use", () => {
    expect(clusterStats(parseStats(fixture), "shop--v1")).toEqual({ completed: 960, errors: 0, healthy: 1 });
  });

  it("reports a cluster Envoy does not know as null (not at the edge)", () => {
    expect(clusterStats(parseStats(fixture), "shop--v3")).toBeNull();
  });

  it("treats membership_healthy without request counters as a known, idle cluster", () => {
    const parsed = parseStats({ stats: [{ name: "cluster.shop--v3.membership_healthy", value: 0 }, { name: "server.uptime", value: 9 }] });
    expect(clusterStats(parsed, "shop--v3")).toEqual({ completed: 0, errors: 0, healthy: 0 });
  });

  it.each([null, {}, { stats: "nope" }, { stats: [{ name: 1, value: 2 }] }, { stats: [] }])("returns null for malformed input %j", (input) => {
    expect(parseStats(input)).toBeNull();
  });

  it("ignores stats outside the filter and histogram entries", () => {
    const parsed = parseStats({
      stats: [{ name: "server.uptime", value: 3 }, { name: "cluster.control-plane.upstream_rq_completed", value: 5 }, { histograms: {} }],
    });
    expect(parsed?.uptimeSeconds).toBe(3);
    expect(clusterStats(parsed, "control-plane")).toBeNull();
  });
});

describe("STATS_FILTER", () => {
  it("is anchored and matches only app clusters and uptime", () => {
    const re = new RegExp(STATS_FILTER);
    expect(re.test("cluster.shop--v1.upstream_rq_5xx")).toBe(true);
    expect(re.test("server.uptime")).toBe(true);
    expect(re.test("cluster.control-plane.upstream_rq_5xx")).toBe(false);
    expect(re.test("cluster.shop--v1.upstream_rq_5xx_extra")).toBe(false);
    expect(re.test("xcluster.shop--v1.upstream_rq_5xx")).toBe(false);
  });
});
