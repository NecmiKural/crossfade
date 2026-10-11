import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { databaseUrl } from "@/lib/env";

export type Db = PostgresJsDatabase<typeof schema>;

let client: { sql: postgres.Sql; db: Db } | undefined;

/** Lazily opens one small pool per process (web, engine and workers each get their own). */
export function getDb(): Db {
  if (!client) {
    const sql = postgres(databaseUrl(), { max: 4 });
    client = { sql, db: drizzle(sql, { schema }) };
  }
  return client.db;
}

export async function closeDb(): Promise<void> {
  const current = client;
  client = undefined;
  await current?.sql.end();
}
