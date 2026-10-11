import { setTimeout as sleep } from "node:timers/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { databaseUrl } from "@/lib/env";
import { errorMessage, log } from "@/lib/log";

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
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
    log("info", "migrations applied");
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  log("error", "migrate failed", { error: errorMessage(error) });
  process.exitCode = 1;
});
