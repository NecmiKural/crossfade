import { setTimeout as sleep } from "node:timers/promises";
import { closeDb, getDb } from "@/lib/db/client";
import { fetchStats, runTick, TICK_MS } from "@/lib/engine/tick";
import { requireSecret } from "@/lib/env";
import { errorMessage, log } from "@/lib/log";

const statsUrl = process.env.EDGE_STATS_URL ?? "http://envoy:9902";
const stop = new AbortController();

process.on("SIGTERM", () => stop.abort());
process.on("SIGINT", () => stop.abort());

/** The rollout worker: ticks every 2 s, never overlapping; finishes the current tick on SIGTERM. */
async function main(): Promise<void> {
  const token = requireSecret("XDS_TOKEN");
  log("info", "engine started", { tickMs: TICK_MS, statsUrl });
  while (!stop.signal.aborted) {
    const started = Date.now();
    try {
      await runTick(getDb(), await fetchStats(statsUrl, token));
    } catch (error) {
      log("error", "tick failed", { error: errorMessage(error) });
    }
    await sleep(Math.max(0, TICK_MS - (Date.now() - started)), undefined, { signal: stop.signal }).catch(() => undefined);
  }
  log("info", "engine stopping");
}

main()
  .catch((error: unknown) => {
    log("error", "engine crashed", { error: errorMessage(error) });
    process.exitCode = 1;
  })
  .finally(closeDb);
