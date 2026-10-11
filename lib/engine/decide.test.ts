import { describe, expect, it } from "vitest";
import { PLANS } from "@/lib/core/plans";
import { decide } from "@/lib/engine/decide";
import type { DecideInput, EdgeStats, EngineRelease } from "@/lib/engine/types";

const T0 = new Date("2026-10-11T12:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const plan = PLANS.demo; // 10%/15s, 50%/15s, minRequests 30, maxErrorRate 0.02, warmup 60s

const warming: EngineRelease = {
  status: "warming",
  statusChangedAt: T0,
  stepIndex: 0,
  weight: 0,
  rdsVersion: 100,
  publishedAt: T0,
  stepLiveAt: null,
  baseline: null,
  holdReason: null,
};
const rollingApplying: EngineRelease = { ...warming, status: "rolling", weight: 10, rdsVersion: 200, publishedAt: at(10) };
const baseline = { at: at(20).toISOString(), stable: { completed: 1000, errors: 2 }, candidate: { completed: 100, errors: 1 } };
const rollingLive: EngineRelease = { ...rollingApplying, stepLiveAt: at(20), baseline };

const stats = (candidate: Partial<{ completed: number; errors: number; healthy: number }> | null, uptimeSeconds = 3600): EdgeStats => ({
  uptimeSeconds,
  stable: { completed: 2000, errors: 3, healthy: 1 },
  candidate: candidate === null ? null : { completed: 100, errors: 1, healthy: 1, ...candidate },
});
const liveEdge = (minAckedRds: number | null) => ({ liveNodeIds: ["edge-1"], minAckedRds });

function input(release: EngineRelease, now: Date, s: EdgeStats | null, edge = liveEdge(200)): DecideInput {
  return { now, plan, release, stats: s, edge };
}

describe("decide(): warming (health gate)", () => {
  it("holds when the stats scrape failed", () => {
    const r = decide(input(warming, at(5), null));
    expect(r.release).toMatchObject({ status: "warming", holdReason: "stats_unavailable" });
    expect(r.publish).toBe(false);
  });

  it("cancels when stats stay unavailable past the warmup timeout", () => {
    const r = decide(input(warming, at(61), null));
    expect(r.release).toMatchObject({ status: "cancelled", weight: 0 });
    expect(r.outcome).toMatchObject({ kind: "cancelled", reason: "stats_unavailable", evidence: { waitedSeconds: 61 } });
  });

  it("holds while Envoy does not know the candidate cluster yet", () => {
    expect(decide(input(warming, at(5), stats(null))).release.holdReason).toBe("candidate_not_at_edge");
  });

  it("cancels without an incident when the candidate never reaches the edge", () => {
    const r = decide(input(warming, at(61), stats(null)));
    expect(r.release).toMatchObject({ status: "cancelled", weight: 0 });
    expect(r.outcome).toMatchObject({ kind: "cancelled", reason: "not_at_edge" });
    expect(r.publish).toBe(true);
  });

  it("starts the first step once the candidate is healthy at the edge", () => {
    const r = decide(input(warming, at(5), stats({ healthy: 1 })));
    expect(r.release).toMatchObject({ status: "rolling", stepIndex: 0, weight: 10, stepLiveAt: null, baseline: null, holdReason: null });
    expect(r.publish).toBe(true);
    expect(r.events.map((e) => e.type)).toEqual(["gate.health_passed"]);
  });

  it("rolls back when the candidate stays unhealthy past the warmup timeout", () => {
    const r = decide(input(warming, at(61), stats({ healthy: 0 })));
    expect(r.release).toMatchObject({ status: "rolled_back", weight: 0 });
    expect(r.outcome).toMatchObject({ kind: "rolled_back", reason: "health_gate_timeout", evidence: { healthy: 0, waitedSeconds: 61 } });
  });

  it("holds while the candidate is present but not healthy yet", () => {
    expect(decide(input(warming, at(5), stats({ healthy: 0 }))).release.holdReason).toBe("candidate_not_healthy");
  });
});

describe("decide(): rolling, applying a step (convergence gate)", () => {
  it("rolls back when the candidate turns unhealthy mid-rollout", () => {
    const r = decide(input(rollingLive, at(25), stats({ healthy: 0 })));
    expect(r.outcome).toMatchObject({ kind: "rolled_back", reason: "candidate_unhealthy", evidence: { healthy: 0, step: 0, weight: 10 } });
  });

  it("does not judge health right after Envoy restarted", () => {
    const r = decide(input(rollingLive, at(25), stats({ healthy: 0 }, 5)));
    expect(r.outcome).toBeUndefined();
    expect(r.release.holdReason).toBe("edge_restarted");
  });

  it("holds while no Envoy node is polling", () => {
    const r = decide({ ...input(rollingApplying, at(12), stats({})), edge: { liveNodeIds: [], minAckedRds: null } });
    expect(r.release.holdReason).toBe("no_live_edge");
  });

  it("marks the step live once every live node acked the step's routes", () => {
    const r = decide(input(rollingApplying, at(13), stats({}), liveEdge(200)));
    expect(r.release.stepLiveAt).toEqual(at(13));
    expect(r.events.map((e) => e.type)).toEqual(["step.live"]);
    expect(r.publish).toBe(false);
  });

  it("waits quietly while the ack is pending", () => {
    const r = decide(input(rollingApplying, at(15), stats({}), liveEdge(199)));
    expect(r.release).toMatchObject({ stepLiveAt: null, holdReason: null });
    expect(r.events).toEqual([]);
  });

  it("flags a suspected NACK when the ack does not arrive within 20 s", () => {
    const r = decide(input(rollingApplying, at(31), stats({}), liveEdge(199)));
    expect(r.release.holdReason).toBe("suspected_nack");
  });
});

describe("decide(): rolling, step live (error budget and bake)", () => {
  it("holds instead of advancing blind when stats are missing", () => {
    expect(decide(input(rollingLive, at(40), null)).release.holdReason).toBe("stats_unavailable");
  });

  it("captures the baseline when the bake starts", () => {
    const r = decide(input({ ...rollingLive, baseline: null }, at(21), stats({ completed: 150, errors: 2 })));
    expect(r.release.baseline).toEqual({ at: at(21).toISOString(), stable: { completed: 2000, errors: 3 }, candidate: { completed: 150, errors: 2 } });
    expect(r.events.map((e) => e.type)).toEqual(["step.bake_started"]);
  });

  it("re-baselines when Envoy restarted during the bake", () => {
    const r = decide(input(rollingLive, at(40), stats({ completed: 5, errors: 0 }, 10)));
    expect(r.release.baseline?.candidate).toEqual({ completed: 5, errors: 0 });
    expect(r.events.map((e) => e.type)).toEqual(["engine.rebaselined"]);
  });

  it("re-baselines when counters go backwards without an uptime reset", () => {
    const r = decide(input(rollingLive, at(30), stats({ completed: 50, errors: 0 })));
    expect(r.events.map((e) => e.type)).toEqual(["engine.rebaselined"]);
    expect(r.release.baseline?.candidate).toEqual({ completed: 50, errors: 0 });
  });

  it("does not mistake uptime rounding for a restart", () => {
    // baseline taken at 20 s; at 40 s an uptime of 19 s is within the 2 s slack
    const r = decide(input(rollingLive, at(40), stats({ completed: 200, errors: 1 }, 19)));
    expect(r.events.map((e) => e.type)).toEqual(["step.published"]);
  });

  it("rolls back when the error budget is breached with enough requests", () => {
    const r = decide(input(rollingLive, at(30), stats({ completed: 141, errors: 14 })));
    expect(r.release).toMatchObject({ status: "rolled_back", weight: 0 });
    expect(r.outcome).toMatchObject({
      kind: "rolled_back",
      reason: "error_budget",
      evidence: { n: 41, errors: 13, maxErrorRate: 0.02, minRequests: 30, step: 0, weight: 10, windowSeconds: 10 },
    });
    expect(r.events[0].message).toContain("error rate 32% > 2% (n=41)");
  });

  it("rolls back on a breached budget even while paused", () => {
    const r = decide(input({ ...rollingLive, status: "paused" }, at(30), stats({ completed: 141, errors: 14 })));
    expect(r.outcome?.reason).toBe("error_budget");
  });

  it("does not judge errors below minRequests", () => {
    const r = decide(input(rollingLive, at(30), stats({ completed: 110, errors: 9 })));
    expect(r.outcome).toBeUndefined();
  });

  it("holds while paused", () => {
    expect(decide(input({ ...rollingLive, status: "paused" }, at(40), stats({ completed: 200, errors: 1 }))).release.holdReason).toBe("paused");
  });

  it("holds with the counts when the bake elapsed without enough traffic", () => {
    const r = decide(input(rollingLive, at(40), stats({ completed: 112, errors: 1 })));
    expect(r.release).toMatchObject({ holdReason: "insufficient_data", holdDetail: { n: 12, minRequests: 30 } });
  });

  it("cancels when traffic stays too low long after the bake", () => {
    // baseline at 20 s + 15 s bake + 120 s grace → give up after 155 s
    const r = decide(input(rollingLive, at(156), stats({ completed: 112, errors: 1 })));
    expect(r.release).toMatchObject({ status: "cancelled", weight: 0 });
    expect(r.outcome).toMatchObject({ kind: "cancelled", reason: "insufficient_data", evidence: { n: 12, minRequests: 30, waitedSeconds: 121 } });
  });

  it("keeps waiting for a person on manual plans even with low traffic", () => {
    const manual = { ...input(rollingLive, at(4000), stats({ completed: 101, errors: 1 }, 10_000)), plan: PLANS.manual };
    expect(decide(manual).release.holdReason).toBe("insufficient_data");
  });

  it("waits for a person on manual plans", () => {
    const manual = { ...input(rollingLive, at(40), stats({ completed: 200, errors: 1 })), plan: PLANS.manual };
    expect(decide(manual).release.holdReason).toBe("awaiting_manual_advance");
  });

  it("advances to the next step after a clean bake", () => {
    const r = decide(input(rollingLive, at(40), stats({ completed: 200, errors: 1 })));
    expect(r.release).toMatchObject({ status: "rolling", stepIndex: 1, weight: 50, stepLiveAt: null, baseline: null, holdReason: null });
    expect(r.publish).toBe(true);
    expect(r.events.map((e) => e.type)).toEqual(["step.published"]);
  });

  it("promotes after the last step", () => {
    const lastStep = { ...rollingLive, stepIndex: 1, weight: 50 };
    const r = decide(input(lastStep, at(40), stats({ completed: 200, errors: 1 })));
    expect(r.release).toMatchObject({ status: "promoted", weight: 100 });
    expect(r.outcome).toMatchObject({ kind: "promoted", reason: "completed" });
    expect(r.publish).toBe(true);
  });

  it("keeps baking until the bake time has passed", () => {
    const r = decide(input(rollingLive, at(30), stats({ completed: 140, errors: 0 })));
    expect(r.release).toMatchObject({ status: "rolling", stepIndex: 0, holdReason: null });
    expect(r.publish).toBe(false);
  });

  it("treats a candidate cluster missing during the rollout as a hold, not a verdict", () => {
    expect(decide(input(rollingLive, at(30), stats(null))).release.holdReason).toBe("candidate_not_at_edge");
  });
});
