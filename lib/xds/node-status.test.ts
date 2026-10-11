import { describe, expect, it } from "vitest";
import { nodeStatus } from "@/lib/xds/node-status";

const now = new Date("2026-10-11T12:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000);

describe("nodeStatus", () => {
  it("is stale when the node stopped polling", () => {
    expect(nodeStatus({ lastSeenAt: ago(16), ackedVersion: 5, servedVersion: 5, servedSince: ago(100), now })).toBe("stale");
  });
  it("is live when the node acked what it was served", () => {
    expect(nodeStatus({ lastSeenAt: ago(1), ackedVersion: 5, servedVersion: 5, servedSince: ago(100), now })).toBe("live");
    expect(nodeStatus({ lastSeenAt: ago(1), ackedVersion: 6, servedVersion: 5, servedSince: ago(100), now })).toBe("live");
  });
  it("is applying shortly after a new version was served", () => {
    expect(nodeStatus({ lastSeenAt: ago(1), ackedVersion: 4, servedVersion: 5, servedSince: ago(10), now })).toBe("applying");
    expect(nodeStatus({ lastSeenAt: ago(1), ackedVersion: null, servedVersion: 5, servedSince: ago(3), now })).toBe("applying");
  });
  it("suspects a NACK when the ack does not arrive within 20 s", () => {
    expect(nodeStatus({ lastSeenAt: ago(1), ackedVersion: 4, servedVersion: 5, servedSince: ago(21), now })).toBe("suspected_nack");
  });
});
