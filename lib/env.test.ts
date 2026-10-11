import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseUrl, readSecret, requireSecret } from "@/lib/env";

afterEach(() => vi.unstubAllEnvs());

function secretFile(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "cf-")), "secret");
  writeFileSync(path, content);
  return path;
}

describe("readSecret", () => {
  it("prefers the direct variable", () => {
    vi.stubEnv("X_TOKEN", "direct");
    vi.stubEnv("X_TOKEN_FILE", secretFile("from-file"));
    expect(readSecret("X_TOKEN")).toBe("direct");
  });

  it("falls back to the trimmed file content", () => {
    vi.stubEnv("X_TOKEN", "");
    vi.stubEnv("X_TOKEN_FILE", secretFile("from-file\n"));
    expect(readSecret("X_TOKEN")).toBe("from-file");
  });

  it("returns undefined when neither is set or the file is empty", () => {
    vi.stubEnv("X_TOKEN", "");
    vi.stubEnv("X_TOKEN_FILE", "");
    expect(readSecret("X_TOKEN")).toBeUndefined();
    vi.stubEnv("X_TOKEN_FILE", secretFile("  \n"));
    expect(readSecret("X_TOKEN")).toBeUndefined();
  });

  it("requireSecret throws a helpful error", () => {
    vi.stubEnv("X_TOKEN", "");
    vi.stubEnv("X_TOKEN_FILE", "");
    expect(() => requireSecret("X_TOKEN")).toThrow("X_TOKEN (or X_TOKEN_FILE)");
  });
});

describe("databaseUrl", () => {
  it("injects an encoded password from the secret file", () => {
    vi.stubEnv("DATABASE_URL", "postgres://crossfade@db:5432/crossfade");
    vi.stubEnv("DATABASE_PASSWORD", "");
    vi.stubEnv("DATABASE_PASSWORD_FILE", secretFile("p@ss/word"));
    expect(databaseUrl()).toBe("postgres://crossfade:p%40ss%2Fword@db:5432/crossfade");
  });

  it("keeps the URL as is without a password secret", () => {
    vi.stubEnv("DATABASE_URL", "postgres://u:p@h:5432/d");
    vi.stubEnv("DATABASE_PASSWORD", "");
    vi.stubEnv("DATABASE_PASSWORD_FILE", "");
    expect(databaseUrl()).toBe("postgres://u:p@h:5432/d");
  });
});
