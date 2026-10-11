import { describe, expect, it } from "vitest";
import {
  AppKey,
  parseInput,
  Domain,
  HealthPath,
  Hostname,
  Password,
  PathPrefix,
  Port,
  Slug,
  VersionName,
} from "@/lib/core/schemas";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

describe("Slug", () => {
  it.each(["shop", "shop-api", "a1", "x"])("accepts %s", (v) => expect(ok(Slug, v)).toBe(true));
  it.each(["Shop", "shop--api", "-shop", "shop-", "sh op", "", "a".repeat(41)])("rejects %s", (v) =>
    expect(ok(Slug, v)).toBe(false),
  );
});

describe("AppKey", () => {
  it.each(["SHOP", "AB", "A1B2C3D4E5"])("accepts %s", (v) => expect(ok(AppKey, v)).toBe(true));
  it.each(["S", "shop", "1SHOP", "SHOP-1", "ABCDEFGHIJK"])("rejects %s", (v) => expect(ok(AppKey, v)).toBe(false));
});

describe("Domain", () => {
  it.each(["localhost", "shop.example.com", "a-b.io", "x1.y2"])("accepts %s", (v) =>
    expect(ok(Domain, v)).toBe(true),
  );
  it.each(["*", "*.example.com", "Shop.com", "-a.com", "a-.com", "a..b", "a_b.com", "", `${"a".repeat(64)}.com`])(
    "rejects %s",
    (v) => expect(ok(Domain, v)).toBe(false),
  );
});

describe("PathPrefix", () => {
  it.each(["/", "/api", "/api/v1", "/a_b~c.d-e"])("accepts %s", (v) => expect(ok(PathPrefix, v)).toBe(true));
  it.each(["", "api", "/api/", "//", "/a//b", "/..", "/a/./b", "/a?b", "/a#b", "/a b"])("rejects %s", (v) =>
    expect(ok(PathPrefix, v)).toBe(false),
  );
});

describe("VersionName", () => {
  it.each(["v1", "v2-canary", "2026-10-11"])("accepts %s", (v) => expect(ok(VersionName, v)).toBe(true));
  it.each(["V1", "v1--x", "a".repeat(31)])("rejects %s", (v) => expect(ok(VersionName, v)).toBe(false));
});

describe("Hostname", () => {
  it.each(["shop-v1", "blog.internal-net", "a"])("accepts %s", (v) => expect(ok(Hostname, v)).toBe(true));
  it.each(["127.0.0.1", "0x7f000001", "2130706433", "[::1]", "::1", "1shop", "Shop", "shop_v1", "", "a..b"])(
    "rejects %s (IP literals and non-hostnames)",
    (v) => expect(ok(Hostname, v)).toBe(false),
  );
});

describe("Port", () => {
  it.each([1, 80, 3000, 65535])("accepts %s", (v) => expect(ok(Port, v)).toBe(true));
  it.each([0, 65536, 3.5, -1, "80"])("rejects %s", (v) => expect(ok(Port, v)).toBe(false));
});

describe("HealthPath", () => {
  it.each(["/healthz", "/", "/status/ready"])("accepts %s", (v) => expect(ok(HealthPath, v)).toBe(true));
  it.each(["healthz", "/a b", "/a?b=1", "/../etc", `/${"a".repeat(200)}`])("rejects %s", (v) =>
    expect(ok(HealthPath, v)).toBe(false),
  );
  it("defaults to /healthz", () => expect(HealthPath.parse(undefined)).toBe("/healthz"));
});

describe("Password", () => {
  it("accepts 12 to 128 characters", () => {
    expect(ok(Password, "a".repeat(12))).toBe(true);
    expect(ok(Password, "a".repeat(128))).toBe(true);
  });
  it("rejects shorter or longer", () => {
    expect(ok(Password, "a".repeat(11))).toBe(false);
    expect(ok(Password, "a".repeat(129))).toBe(false);
  });
});

describe("parseInput", () => {
  it("returns the parsed value or throws invalid_request with field errors", () => {
    expect(parseInput(Port, 8080)).toBe(8080);
    expect(() => parseInput(Port, 0)).toThrow(expect.objectContaining({ code: "invalid_request" }));
  });
});
