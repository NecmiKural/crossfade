import { z } from "zod";
import type { ClusterStats } from "@/lib/engine/types";

/** RE2 filter for GET /stats: app clusters' request, 5xx and health counters, plus server uptime. */
export const STATS_FILTER = "^(cluster\\.[a-z0-9-]+--[a-z0-9-]+\\.(upstream_rq_completed|upstream_rq_5xx|membership_healthy)|server\\.uptime)$";

const StatsJson = z.object({
  stats: z.array(z.union([z.object({ name: z.string(), value: z.number() }), z.object({ histograms: z.unknown() })])),
});

export type ParsedStats = Readonly<{ uptimeSeconds: number; values: ReadonlyMap<string, number> }>;

/** Parses Envoy's `/stats?format=json`. Returns null when the payload is not what Envoy sends. */
export function parseStats(json: unknown): ParsedStats | null {
  const parsed = StatsJson.safeParse(json);
  if (!parsed.success) return null;
  const values = new Map<string, number>();
  for (const entry of parsed.data.stats) {
    if ("name" in entry) values.set(entry.name, entry.value);
  }
  const uptime = values.get("server.uptime");
  return uptime === undefined ? null : { uptimeSeconds: uptime, values };
}

/**
 * Counters for one cluster. membership_healthy exists from cluster init, so its absence means Envoy
 * does not know the cluster. upstream_rq_5xx is created on first use, so a missing one means zero.
 */
export function clusterStats(parsed: ParsedStats | null, cluster: string): ClusterStats | null {
  const healthy = parsed?.values.get(`cluster.${cluster}.membership_healthy`);
  if (!parsed || healthy === undefined) return null;
  return {
    completed: parsed.values.get(`cluster.${cluster}.upstream_rq_completed`) ?? 0,
    errors: parsed.values.get(`cluster.${cluster}.upstream_rq_5xx`) ?? 0,
    healthy,
  };
}
