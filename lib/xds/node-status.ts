export type NodeStatus = "stale" | "live" | "applying" | "suspected_nack";

export const STALE_AFTER_MS = 15_000;
export const NACK_AFTER_MS = 20_000;

/**
 * Health of one Envoy node for one resource type. Envoy only advances version_info after it
 * accepted an update, so "acked < served for too long" is the only rejection signal (an inference).
 */
export function nodeStatus(input: { lastSeenAt: Date; ackedVersion: number | null; servedVersion: number; servedSince: Date; now: Date }): NodeStatus {
  const { now } = input;
  if (now.getTime() - input.lastSeenAt.getTime() > STALE_AFTER_MS) return "stale";
  if (input.ackedVersion !== null && input.ackedVersion >= input.servedVersion) return "live";
  return now.getTime() - input.servedSince.getTime() > NACK_AFTER_MS ? "suspected_nack" : "applying";
}
