// Config for the Better Auth CLI only:
//   npx auth@1.7.7 generate --config auth.cli.ts --adapter drizzle --dialect postgresql --output lib/db/auth-schema.ts -y
// Migrations are then generated with drizzle-kit. The app never imports this file.
import { betterAuth } from "better-auth";
import { baseAuthOptions } from "./lib/auth-options";

export const auth = betterAuth(baseAuthOptions);
