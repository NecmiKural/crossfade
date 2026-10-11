import { sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { apps, versions } from "@/lib/db/schema";

/** Empties every table between tests; the schema itself is rebuilt once by global-setup. */
export async function resetDb(): Promise<void> {
  const tables = await getDb().execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const names = tables.map((t) => `"${t.tablename}"`).join(", ");
  if (names) await getDb().execute(sql.raw(`TRUNCATE ${names} RESTART IDENTITY CASCADE`));
}

/** Postgres error code of a failed query (drizzle wraps the driver error in `cause`). */
export async function pgErrorCode(query: Promise<unknown>): Promise<string | undefined> {
  try {
    await query;
    return undefined;
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
}

export const testerToken = (): string => randomBytes(32).toString("hex");

export async function insertApp(slug: string, overrides: Partial<typeof apps.$inferInsert> = {}) {
  const [row] = await getDb()
    .insert(apps)
    .values({
      slug,
      key: slug.replace(/[^a-z0-9]/g, "").toUpperCase().slice(0, 10) || "APP",
      domain: `${slug}.localhost`,
      testerToken: testerToken(),
      ...overrides,
    })
    .returning();
  return row;
}

export async function insertVersion(appId: string, name: string, overrides: Partial<typeof versions.$inferInsert> = {}) {
  const [row] = await getDb()
    .insert(versions)
    .values({ appId, name, host: `${name}-host`, port: 3000, ...overrides })
    .returning();
  return row;
}
