import {
  ACK_TIMEOUT_MS,
  type Baseline,
  type DecideInput,
  type DecideResult,
  EDGE_SETTLE_SECONDS,
  type EventDraft,
  type HoldReason,
  type Outcome,
  type ReleaseState,
} from "@/lib/engine/types";

const pct = (rate: number): string => `${Math.round(rate * 100)}%`;
const secondsBetween = (from: Date, to: Date): number => Math.round((to.getTime() - from.getTime()) / 1000);

function current(input: DecideInput): ReleaseState {
  const r = input.release;
  return { status: r.status, stepIndex: r.stepIndex, weight: r.weight, stepLiveAt: r.stepLiveAt, baseline: r.baseline, holdReason: null, holdDetail: null };
}

function hold(input: DecideInput, reason: HoldReason, detail: Record<string, unknown> | null = null): DecideResult {
  return { release: { ...current(input), holdReason: reason, holdDetail: detail }, events: [], publish: false };
}

function proceed(input: DecideInput, changes: Partial<ReleaseState>, events: EventDraft[] = [], publish = false): DecideResult {
  return { release: { ...current(input), ...changes }, events, publish };
}

/** Ends the release. Rollbacks and cancels send all traffic back to stable; promotion hands it to the candidate. */
function finish(input: DecideInput, outcome: Outcome, message: string): DecideResult {
  const promoted = outcome.kind === "promoted";
  return {
    release: { ...current(input), status: outcome.kind, weight: promoted ? 100 : 0, holdReason: null, holdDetail: null },
    events: [{ type: `release.${outcome.kind}`, message, data: { reason: outcome.reason, ...outcome.evidence } }],
    publish: true,
    outcome,
  };
}

/** Warming: the candidate gets no traffic until Envoy reports it healthy (health gate). */
function decideWarming(input: DecideInput): DecideResult {
  const { stats, plan, release, now } = input;
  const waitedSeconds = secondsBetween(release.statusChangedAt, now);
  const timedOut = waitedSeconds > plan.warmupTimeoutSeconds;
  if (!stats) {
    // A dead stats listener must not keep the release (and the app's next one) waiting forever.
    if (!timedOut) return hold(input, "stats_unavailable");
    return finish(input, { kind: "cancelled", reason: "stats_unavailable", evidence: { waitedSeconds } }, `no edge stats for ${waitedSeconds} s, cancelled`);
  }
  if (!stats.candidate) {
    if (!timedOut) return hold(input, "candidate_not_at_edge");
    return finish(input, { kind: "cancelled", reason: "not_at_edge", evidence: { waitedSeconds } }, `candidate never reached the edge in ${waitedSeconds} s, cancelled`);
  }
  if (stats.candidate.healthy >= 1) {
    const first = plan.steps[0];
    const event = { type: "gate.health_passed", message: `candidate healthy at the edge; step 1 at ${first.weight}%` };
    return proceed(input, { status: "rolling", stepIndex: 0, weight: first.weight, stepLiveAt: null, baseline: null }, [event], true);
  }
  if (!timedOut) return hold(input, "candidate_not_healthy");
  return finish(input, { kind: "rolled_back", reason: "health_gate_timeout", evidence: { waitedSeconds, healthy: 0 } }, `candidate still unhealthy after ${waitedSeconds} s, rolled back`);
}

/** Applying: a step's bake starts only once every live Envoy node acked the routes that carry it. */
function decideApplying(input: DecideInput): DecideResult {
  const { edge, release, now } = input;
  if (edge.liveNodeIds.length === 0) return hold(input, "no_live_edge");
  if (release.rdsVersion !== null && edge.minAckedRds !== null && edge.minAckedRds >= release.rdsVersion) {
    const event = { type: "step.live", message: `step ${release.stepIndex + 1} live on ${edge.liveNodeIds.join(", ")} (routes v${release.rdsVersion})` };
    return proceed(input, { stepLiveAt: now }, [event]);
  }
  if (release.publishedAt && now.getTime() - release.publishedAt.getTime() > ACK_TIMEOUT_MS) {
    // Envoy never reports why it rejects REST config; a version that does not advance is all we see.
    return hold(input, "suspected_nack");
  }
  return proceed(input, {});
}

function baselineFrom(input: DecideInput): Baseline {
  const { stats, now } = input;
  const pick = (c: { completed: number; errors: number } | null | undefined) => ({ completed: c?.completed ?? 0, errors: c?.errors ?? 0 });
  return { at: now.toISOString(), stable: pick(stats?.stable), candidate: pick(stats?.candidate) };
}

/** Uptime is a whole number read slightly before `now`, so allow a little slack before calling it a restart. */
const UPTIME_SLACK_SECONDS = 2;

/** Counters reset when Envoy restarts (uptime) or, defensively, whenever they go backwards. */
function countersReset(baseline: Baseline, stats: NonNullable<DecideInput["stats"]>, now: Date): boolean {
  const restarted = stats.uptimeSeconds + UPTIME_SLACK_SECONDS < (now.getTime() - Date.parse(baseline.at)) / 1000;
  const candidate = stats.candidate;
  const backwards = !!candidate && (candidate.completed < baseline.candidate.completed || candidate.errors < baseline.candidate.errors);
  return restarted || backwards;
}

/** Live: watch the error budget over the step's window, then advance, promote or wait. */
function decideLive(input: DecideInput): DecideResult {
  const { stats, release, plan, now } = input;
  if (!stats) return hold(input, "stats_unavailable");
  if (!stats.candidate) return hold(input, "candidate_not_at_edge");
  if (!release.baseline || countersReset(release.baseline, stats, now)) {
    const type = release.baseline ? "engine.rebaselined" : "step.bake_started";
    const message = release.baseline ? "edge counters reset (Envoy restarted); analysis window restarted" : `bake started at ${release.weight}%`;
    return proceed(input, { baseline: baselineFrom(input) }, [{ type, message }]);
  }
  const n = stats.candidate.completed - release.baseline.candidate.completed;
  const errors = stats.candidate.errors - release.baseline.candidate.errors;
  const windowSeconds = secondsBetween(new Date(release.baseline.at), now);
  if (n >= plan.minRequests && errors / n > plan.maxErrorRate) {
    const evidence = { errorRate: errors / n, n, errors, maxErrorRate: plan.maxErrorRate, minRequests: plan.minRequests, step: release.stepIndex, weight: release.weight, windowSeconds };
    return finish(input, { kind: "rolled_back", reason: "error_budget", evidence }, `error rate ${pct(errors / n)} > ${pct(plan.maxErrorRate)} (n=${n}) — rolled back`);
  }
  if (release.status === "paused") return hold(input, "paused");
  const bakeSeconds = plan.steps[release.stepIndex]?.bakeSeconds ?? 0;
  if (windowSeconds < bakeSeconds) return proceed(input, {});
  return afterBake(input, n, windowSeconds - bakeSeconds);
}

function afterBake(input: DecideInput, n: number, secondsPastBake: number): DecideResult {
  const { plan, release } = input;
  if (n < plan.minRequests) {
    const limit = plan.insufficientDataTimeoutSeconds;
    if (limit === null || secondsPastBake <= limit) return hold(input, "insufficient_data", { n, minRequests: plan.minRequests });
    const evidence = { n, minRequests: plan.minRequests, waitedSeconds: secondsPastBake };
    return finish(input, { kind: "cancelled", reason: "insufficient_data", evidence }, `only ${n} of ${plan.minRequests} requests after ${secondsPastBake} s, cancelled`);
  }
  if (!plan.autoAdvance) return hold(input, "awaiting_manual_advance");
  const next = plan.steps[release.stepIndex + 1];
  if (!next) return finish(input, { kind: "promoted", reason: "completed", evidence: { steps: plan.steps.length, n } }, `all ${plan.steps.length} steps clean — promoted`);
  const event = { type: "step.published", message: `step ${release.stepIndex + 2} at ${next.weight}%` };
  return proceed(input, { stepIndex: release.stepIndex + 1, weight: next.weight, stepLiveAt: null, baseline: null }, [event], true);
}

/**
 * The rollout state machine. Pure: no I/O, no clock, new objects out. The engine worker feeds it
 * Envoy's own counters and acks, and applyResult() turns the result into rows, events and snapshots.
 */
export function decide(input: DecideInput): DecideResult {
  const { release, stats } = input;
  if (release.status === "warming") return decideWarming(input);
  if (stats?.candidate && stats.candidate.healthy === 0) {
    if (stats.uptimeSeconds < EDGE_SETTLE_SECONDS) return hold(input, "edge_restarted");
    const evidence = { healthy: 0, step: release.stepIndex, weight: release.weight };
    return finish(input, { kind: "rolled_back", reason: "candidate_unhealthy", evidence }, "candidate failed its health checks — rolled back");
  }
  return release.stepLiveAt === null ? decideApplying(input) : decideLive(input);
}
