import type { Plan } from "@/lib/core/plans";

export type Counters = Readonly<{ completed: number; errors: number }>;
/** Per-cluster numbers read from Envoy. `healthy` is membership_healthy (hosts passing health checks). */
export type ClusterStats = Readonly<Counters & { healthy: number }>;

export type EdgeStats = Readonly<{
  uptimeSeconds: number;
  /** null when Envoy does not know the cluster (not in its CDS yet). */
  stable: ClusterStats | null;
  candidate: ClusterStats | null;
}>;

/** Counters at the start of the current analysis window; reset per step, on resume and on Envoy restarts. */
export type Baseline = Readonly<{ at: string; stable: Counters; candidate: Counters }>;

export type HoldReason =
  | "stats_unavailable"
  | "candidate_not_at_edge"
  | "candidate_not_healthy"
  | "edge_restarted"
  | "no_live_edge"
  | "suspected_nack"
  | "paused"
  | "insufficient_data"
  | "awaiting_manual_advance";

export type EngineStatus = "warming" | "rolling" | "paused";

export type EngineRelease = Readonly<{
  status: EngineStatus;
  statusChangedAt: Date;
  stepIndex: number;
  weight: number;
  /** RDS version of the snapshot that carries the current step's weights. */
  rdsVersion: number | null;
  publishedAt: Date | null;
  stepLiveAt: Date | null;
  baseline: Baseline | null;
  holdReason: HoldReason | null;
}>;

export type DecideInput = Readonly<{
  now: Date;
  plan: Plan;
  release: EngineRelease;
  /** null when the stats scrape failed. */
  stats: EdgeStats | null;
  edge: Readonly<{ liveNodeIds: readonly string[]; minAckedRds: number | null }>;
}>;

export type OutcomeReason =
  | "completed"
  | "error_budget"
  | "candidate_unhealthy"
  | "health_gate_timeout"
  | "not_at_edge"
  | "stats_unavailable"
  | "insufficient_data"
  | "manual";

export type Outcome = Readonly<{
  kind: "promoted" | "rolled_back" | "cancelled";
  reason: OutcomeReason;
  evidence: Record<string, unknown>;
}>;

export type ReleaseState = Readonly<{
  status: EngineStatus | "promoted" | "rolled_back" | "cancelled";
  stepIndex: number;
  weight: number;
  stepLiveAt: Date | null;
  baseline: Baseline | null;
  holdReason: HoldReason | null;
  holdDetail: Record<string, unknown> | null;
}>;

export type EventDraft = Readonly<{ type: string; message: string; data?: Record<string, unknown> }>;

export type DecideResult = Readonly<{
  release: ReleaseState;
  events: readonly EventDraft[];
  /** Weights changed: render and publish a new snapshot. */
  publish: boolean;
  outcome?: Outcome;
}>;

/** Envoy has just (re)started; give health checks a moment before judging health. */
export const EDGE_SETTLE_SECONDS = 30;
/** How long a published step may stay unacknowledged before it is flagged as a suspected NACK. */
export const ACK_TIMEOUT_MS = 20_000;
