import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/core/hash";

describe("sha256Hex", () => {
  it("matches the known digest of an empty string", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
