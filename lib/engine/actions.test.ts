import { describe, expect, it } from "vitest";
import { PLANS } from "@/lib/core/plans";
import { applyControl, type Control, type ControlRelease } from "@/lib/engine/actions";

const live = new Date("2026-10-11T12:00:00Z");
const rolling: ControlRelease = { status: "rolling", stepIndex: 0, weight: 10, stepLiveAt: live, baseline: null, plan: PLANS.demo };

describe("applyControl", () => {
  it("advances a live step to the next weight and publishes", () => {
    const r = applyControl(rolling, "advance");
    expect(r).toMatchObject({ release: { status: "rolling", stepIndex: 1, weight: 50, stepLiveAt: null, baseline: null }, publish: true });
  });

  it("promotes when advancing past the last step", () => {
    const r = applyControl({ ...rolling, stepIndex: 1, weight: 50 }, "advance");
    expect(r).toMatchObject({ release: { status: "promoted", weight: 100 }, outcome: { kind: "promoted", reason: "manual" } });
  });

  it("refuses to advance a step Envoy has not applied yet", () => {
    expect(applyControl({ ...rolling, stepLiveAt: null }, "advance")).toEqual({ error: "the current step is not live on the edge yet" });
  });

  it("pauses and resumes; resume restarts the bake on fresh counters", () => {
    const paused = applyControl(rolling, "pause");
    expect(paused).toMatchObject({ release: { status: "paused" }, publish: false });
    const resumed = applyControl({ ...rolling, status: "paused", baseline: { at: live.toISOString(), stable: { completed: 1, errors: 0 }, candidate: { completed: 1, errors: 0 } } }, "resume");
    expect(resumed).toMatchObject({ release: { status: "rolling", baseline: null } });
  });

  it("promotes now from rolling or paused", () => {
    expect(applyControl({ ...rolling, status: "paused" }, "promote")).toMatchObject({ release: { status: "promoted", weight: 100 }, publish: true });
  });

  it.each(["pending_approval", "warming", "rolling", "paused"] as const)("aborts from %s with traffic back to stable and no incident", (status) => {
    const r = applyControl({ ...rolling, status }, "abort");
    expect(r).toMatchObject({ release: { status: "cancelled", weight: 0 }, publish: true, outcome: { kind: "cancelled", reason: "manual" } });
  });

  it("approves a pending release into warming", () => {
    expect(applyControl({ ...rolling, status: "pending_approval", weight: 0, stepLiveAt: null }, "approve")).toMatchObject({ release: { status: "warming" } });
  });

  it.each([
    ["pause", "paused"],
    ["resume", "rolling"],
    ["advance", "warming"],
    ["promote", "warming"],
    ["approve", "rolling"],
    ["abort", "promoted"],
    ["abort", "rolled_back"],
  ] as const)("refuses %s while %s", (control, status) => {
    expect(applyControl({ ...rolling, status }, control)).toHaveProperty("error");
  });

  it("refuses a control it does not know", () => {
    expect(applyControl(rolling, "toString" as Control)).toEqual({ error: "unknown control toString" });
  });
});
