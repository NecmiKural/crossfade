import type { Plan } from "@/lib/core/plans";
import type { Baseline, DecideResult, ReleaseState } from "@/lib/engine/types";

export type Control = "approve" | "advance" | "pause" | "resume" | "promote" | "abort";

export type ControlRelease = Readonly<{
  status: "pending_approval" | "warming" | "rolling" | "paused" | "promoted" | "rolled_back" | "cancelled";
  stepIndex: number;
  weight: number;
  stepLiveAt: Date | null;
  baseline: Baseline | null;
  plan: Plan;
}>;

const ACTIVE = new Set(["pending_approval", "warming", "rolling", "paused"]);

function state(r: ControlRelease, changes: Partial<ReleaseState>): ReleaseState {
  return { status: r.status as ReleaseState["status"], stepIndex: r.stepIndex, weight: r.weight, stepLiveAt: r.stepLiveAt, baseline: r.baseline, holdReason: null, holdDetail: null, ...changes };
}

function promote(r: ControlRelease): DecideResult {
  return {
    release: state(r, { status: "promoted", weight: 100 }),
    events: [{ type: "release.promoted", message: "promoted by hand" }],
    publish: true,
    outcome: { kind: "promoted", reason: "manual", evidence: { step: r.stepIndex, weight: r.weight } },
  };
}

function advance(r: ControlRelease): DecideResult | { error: string } {
  if (r.status !== "rolling" && r.status !== "paused") return { error: `cannot advance a ${r.status} release` };
  if (!r.stepLiveAt) return { error: "the current step is not live on the edge yet" };
  const next = r.plan.steps[r.stepIndex + 1];
  if (!next) return promote(r);
  const event = { type: "step.published", message: `advanced by hand to step ${r.stepIndex + 2} at ${next.weight}%` };
  return { release: state(r, { status: "rolling", stepIndex: r.stepIndex + 1, weight: next.weight, stepLiveAt: null, baseline: null }), events: [event], publish: true };
}

/**
 * What a person's button press does to a release (pure). Who may press it is decided by `can()`;
 * this only decides whether the release is in a state where it makes sense.
 */
export function applyControl(r: ControlRelease, control: Control): DecideResult | { error: string } {
  switch (control) {
    case "approve":
      if (r.status !== "pending_approval") return { error: `cannot approve a ${r.status} release` };
      return { release: state(r, { status: "warming" }), events: [{ type: "release.approved", message: "approved" }], publish: false };
    case "advance":
      return advance(r);
    case "pause":
      if (r.status !== "rolling") return { error: `cannot pause a ${r.status} release` };
      return { release: state(r, { status: "paused" }), events: [{ type: "release.paused", message: "paused by hand" }], publish: false };
    case "resume":
      if (r.status !== "paused") return { error: `cannot resume a ${r.status} release` };
      // The bake restarts on fresh counters, so time spent paused never counts as clean bake time.
      return { release: state(r, { status: "rolling", baseline: null }), events: [{ type: "release.resumed", message: "resumed by hand" }], publish: false };
    case "promote":
      if (r.status !== "rolling" && r.status !== "paused") return { error: `cannot promote a ${r.status} release` };
      return promote(r);
    case "abort":
      if (!ACTIVE.has(r.status)) return { error: `cannot abort a ${r.status} release` };
      return {
        release: state(r, { status: "cancelled", weight: 0 }),
        events: [{ type: "release.cancelled", message: "aborted by hand; all traffic back to stable" }],
        publish: true,
        outcome: { kind: "cancelled", reason: "manual", evidence: { step: r.stepIndex, weight: r.weight } },
      };
    default:
      return { error: `unknown control ${String(control)}` };
  }
}
