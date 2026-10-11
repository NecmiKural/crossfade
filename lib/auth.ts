import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { baseAuthOptions } from "@/lib/auth-options";
import { getDb } from "@/lib/db/client";
import { authUrl, requireSecret } from "@/lib/env";

function createAuth() {
  const baseURL = authUrl();
  return betterAuth({
    ...baseAuthOptions,
    database: drizzleAdapter(getDb(), { provider: "pg" }),
    secret: requireSecret("BETTER_AUTH_SECRET"),
    baseURL,
    trustedOrigins: [baseURL],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** Lazy: betterAuth() validates its secret at construction, which must not happen during `next build`. */
export function getAuth(): ReturnType<typeof createAuth> {
  instance ??= createAuth();
  return instance;
}
