import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export const DEFAULT_TEST_DATABASE_URL = "postgres://crossfade:crossfade-dev-only@127.0.0.1:5432/crossfade_test";

/** Creates the test database if needed, then rebuilds its schema from the migrations. */
export default async function setup(): Promise<void> {
  const url = new URL(process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL);
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(`Refusing to run db tests against "${name}": the database name must end in _test`);
  }
  await ensureDatabase(url, name);
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
  } finally {
    await sql.end();
  }
}

async function ensureDatabase(url: URL, name: string): Promise<void> {
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const rows = await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    // The name is validated above, so interpolating it into DDL is safe.
    if (rows.length === 0) await sql.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await sql.end();
  }
}
