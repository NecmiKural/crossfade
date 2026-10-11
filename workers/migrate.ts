import { setTimeout as sleep } from "node:timers/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { databaseUrl } from "@/lib/env";
import { errorMessage, log } from "@/lib/log";
import { publishSnapshot } from "@/lib/xds/publish";

const CONNECT_ATTEMPTS = 15;

async function connectWithRetry(url: string): Promise<postgres.Sql> {
  for (let attempt = 1; ; attempt++) {
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await sql`SELECT 1`;
      return sql;
    } catch (error) {
      await sql.end({ timeout: 1 });
      if (attempt >= CONNECT_ATTEMPTS) throw error;
      log("warn", "database not ready, retrying", { attempt, error: errorMessage(error) });
      await sleep(1000);
    }
  }
}

async function main(): Promise<void> {
  const sql = await connectWithRetry(databaseUrl());
  try {
    const db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: "drizzle" });
    log("info", "migrations applied");
    // Re-render on every deploy, so a changed renderer ("the template") reaches Envoy for every app at once.
    const snapshot = await db.transaction((tx) => publishSnapshot(tx, { reason: "migrate", actor: { kind: "system", id: null } }));
    log("info", "snapshot published", { rev: snapshot.id, cdsVersion: snapshot.cdsVersion, rdsVersion: snapshot.rdsVersion });
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  log("error", "migrate failed", { error: errorMessage(error) });
  process.exitCode = 1;
});
