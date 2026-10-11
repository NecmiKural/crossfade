import { readFileSync } from "node:fs";
import { type Allowlist, parseAllowlist } from "@/lib/core/allowlist";

/**
 * Reads NAME from the environment, or the file named by NAME_FILE (Docker secrets style).
 * Everything here is lazy so `next build` never needs runtime secrets.
 */
export function readSecret(name: string): string | undefined {
  const direct = process.env[name];
  if (direct) return direct;
  const file = process.env[`${name}_FILE`];
  if (!file) return undefined;
  const value = readFileSync(file, "utf8").trim();
  return value === "" ? undefined : value;
}

export function requireSecret(name: string): string {
  const value = readSecret(name);
  if (!value) throw new Error(`Missing required setting ${name} (or ${name}_FILE)`);
  return value;
}

/** DATABASE_URL, with the password taken from DATABASE_PASSWORD(_FILE) when provided. */
export function databaseUrl(): string {
  const url = new URL(requireSecret("DATABASE_URL"));
  const password = readSecret("DATABASE_PASSWORD");
  // The URL setter percent-encodes by itself; encoding first would double-encode "%" and friends.
  if (password) url.password = password;
  return url.toString();
}

let allowlistCache: { raw: string; list: Allowlist } | undefined;

/** The operator's per-app upstream allowlist (UPSTREAM_ALLOWLIST). Unset means deny everything. */
export function upstreamAllowlist(): Allowlist {
  const raw = process.env.UPSTREAM_ALLOWLIST ?? "";
  if (allowlistCache?.raw !== raw) allowlistCache = { raw, list: parseAllowlist(raw) };
  return allowlistCache.list;
}

/** The canonical dashboard origin. Cookies are issued for it only, never for the edge (:8080). */
export function authUrl(): string {
  return process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
}
