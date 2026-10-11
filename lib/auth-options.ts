import type { BetterAuthOptions } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";

/**
 * Options shared by the app (lib/auth.ts) and the schema generator (auth.cli.ts).
 * No database, secrets or env reads here, so importing it is side-effect free.
 */
export const baseAuthOptions = {
  emailAndPassword: {
    enabled: true,
    // Accounts are created only by the first-run setup or by an admin (ADR-0004).
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  // nextCookies must stay last so Server Actions can set the session cookie.
  plugins: [admin(), nextCookies()],
} satisfies Partial<BetterAuthOptions>;
