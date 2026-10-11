import { describe, expect, it } from "vitest";
import { constantTimeEqual, sha256Hex } from "@/lib/core/hash";

describe("sha256Hex", () => {
  it("matches the known digest of an empty string", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("constantTimeEqual", () => {
  it("compares secrets of any length", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("abc", null)).toBe(false);
    expect(constantTimeEqual("abc", undefined)).toBe(false);
  });
});
