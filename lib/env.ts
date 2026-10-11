import { readFileSync } from "node:fs";

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
  if (password) url.password = encodeURIComponent(password);
  return url.toString();
}
