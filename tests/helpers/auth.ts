import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { user } from "@/lib/db/schema";

export const DASHBOARD = "http://127.0.0.1:3000";

/** Turns Set-Cookie headers into a Cookie header: last non-empty value per name wins. */
export function cookieHeader(res: Response): string {
  const jar = new Map<string, string>();
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** Creates a user (server-side, no session needed) and returns a signed-in cookie header for them. */
export async function signedInUser(email: string, role: "admin" | "user" = "user"): Promise<{ id: string; cookie: string }> {
  const password = "correct-horse-battery";
  const created = await getAuth().api.createUser({ body: { name: email, email, password, role } });
  const res = await getAuth().api.signInEmail({ body: { email, password }, asResponse: true });
  return { id: created.user.id, cookie: cookieHeader(res) };
}

export async function banUser(id: string): Promise<void> {
  await getDb().update(user).set({ banned: true }).where(eq(user.id, id));
}

export function stubAuthEnv(stub: (name: string, value: string) => void): void {
  stub("BETTER_AUTH_SECRET", "b".repeat(64));
  stub("BETTER_AUTH_URL", DASHBOARD);
}
