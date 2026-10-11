import { count, sql } from "drizzle-orm";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { constantTimeEqual } from "@/lib/core/hash";
import { Password } from "@/lib/core/schemas";
import { getDb } from "@/lib/db/client";
import { user } from "@/lib/db/schema";

const SETUP_LOCK = 0x63660002;

export const SetupRequest = z.object({
  token: z.string().max(256),
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254),
  password: Password,
});

export type SetupResult =
  | { status: 201; userId: string }
  | { status: 400; error: "invalid_request"; issues: unknown }
  | { status: 401; error: "invalid_token" }
  | { status: 403; error: "setup_complete" };

export async function countUsers(): Promise<number> {
  const [row] = await getDb().select({ n: count() }).from(user);
  return row.n;
}

/**
 * Creates the first (admin) account. Only works while no user exists, and only with the
 * one-time setup token printed by `migrate`. Concurrent calls are serialized by an advisory lock.
 */
export async function runSetup(body: unknown, expectedToken: string): Promise<SetupResult> {
  const parsed = SetupRequest.safeParse(body);
  if (!parsed.success) return { status: 400, error: "invalid_request", issues: z.flattenError(parsed.error).fieldErrors };
  if (!constantTimeEqual(expectedToken, parsed.data.token)) return { status: 401, error: "invalid_token" };
  const { name, email, password } = parsed.data;
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SETUP_LOCK})`);
    const [row] = await tx.select({ n: count() }).from(user);
    if (row.n > 0) return { status: 403, error: "setup_complete" } as const;
    // Called without request headers, Better Auth's admin createUser runs as the server itself.
    const created = await getAuth().api.createUser({ body: { name, email, password, role: "admin" } });
    return { status: 201, userId: created.user.id } as const;
  });
}
