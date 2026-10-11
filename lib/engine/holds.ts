import type { HoldReason } from "@/lib/engine/types";

/** Plain-English hold reasons, shared by the audit trail and the console. */
export const HOLD_MESSAGES: Readonly<Record<HoldReason, string>> = {
  stats_unavailable: "Envoy stats unavailable",
  candidate_not_at_edge: "candidate cluster not at the edge yet",
  candidate_not_healthy: "candidate not healthy yet",
  edge_restarted: "Envoy restarted moments ago",
  no_live_edge: "no Envoy node is polling",
  suspected_nack: "Envoy has not applied the step (suspected NACK, inferred from version_info)",
  paused: "paused",
  insufficient_data: "not enough requests to judge",
  awaiting_manual_advance: "waiting for a person to advance",
  engine_error: "the engine failed to process this release (see the engine log)",
};

export function holdMessage(reason: string): string {
  return HOLD_MESSAGES[reason as HoldReason] ?? reason;
}
