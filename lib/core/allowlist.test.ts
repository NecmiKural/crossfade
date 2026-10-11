import { describe, expect, it } from "vitest";
import { isAllowed, parseAllowlist } from "@/lib/core/allowlist";

describe("parseAllowlist", () => {
  it("parses apps with several upstreams", () => {
    const list = parseAllowlist(" shop = shop-v1:3000, shop-v2:3000 ; blog=blog-blue:8080 ");
    expect(list.get("shop")).toEqual([
      { host: "shop-v1", port: 3000 },
      { host: "shop-v2", port: 3000 },
    ]);
    expect(list.get("blog")).toEqual([{ host: "blog-blue", port: 8080 }]);
  });

  it("treats an empty value as deny-all", () => {
    expect(parseAllowlist("").size).toBe(0);
    expect(parseAllowlist("  ").size).toBe(0);
  });

  it.each([
    ["missing =", "shop"],
    ["bad app slug", "Shop=shop-v1:3000"],
    ["missing port", "shop=shop-v1"],
    ["bad port", "shop=shop-v1:0"],
    ["non-numeric port", "shop=shop-v1:http"],
    ["IPv4 literal", "shop=127.0.0.1:80"],
    ["IPv6 literal", "shop=[::1]:80"],
    ["decimal IP", "shop=2130706433:80"],
    ["localhost", "shop=localhost:3000"],
    ["*.localhost", "shop=api.localhost:3000"],
    ["*.internal", "shop=metadata.google.internal:80"],
    ["platform db", "shop=db:5432"],
    ["platform web", "shop=web:3000"],
    ["platform envoy", "shop=envoy:9902"],
    ["platform engine", "shop=engine:3000"],
    ["platform migrate", "shop=migrate:1"],
    ["platform init", "shop=init:1"],
    ["crossfade-* container", "shop=crossfade-db-1:5432"],
    ["duplicate app", "shop=a:1;shop=b:1"],
    ["empty upstream list", "shop="],
  ])("rejects %s", (_name, raw) => {
    expect(() => parseAllowlist(raw)).toThrow(/UPSTREAM_ALLOWLIST/);
  });

  it("rejects the same upstream listed under two apps (cross-app reuse)", () => {
    expect(() => parseAllowlist("shop=svc:3000;blog=svc:3000")).toThrow(/more than one app/);
  });

  it("allows the same host on different ports for different apps", () => {
    expect(() => parseAllowlist("shop=svc:3000;blog=svc:3001")).not.toThrow();
  });
});

describe("isAllowed", () => {
  const list = parseAllowlist("shop=shop-v1:3000,shop-v2:3000;blog=blog-blue:8080");

  it("allows a listed upstream for its own app", () => {
    expect(isAllowed(list, "shop", "shop-v2", 3000)).toBe(true);
  });

  it("denies another app's upstream", () => {
    expect(isAllowed(list, "blog", "shop-v1", 3000)).toBe(false);
  });

  it("denies a different port", () => {
    expect(isAllowed(list, "shop", "shop-v1", 3001)).toBe(false);
  });

  it("denies unknown apps", () => {
    expect(isAllowed(list, "nope", "shop-v1", 3000)).toBe(false);
  });

  it("compares hosts case-insensitively", () => {
    expect(isAllowed(list, "shop", "SHOP-V1", 3000)).toBe(true);
  });
});
