import { describe, expect, it } from "vitest";
import { incidentKey, parseKey, releaseKey } from "@/lib/core/keys";

describe("Jira-style keys", () => {
  it("formats release and incident keys", () => {
    expect(releaseKey("SHOP", 7)).toBe("SHOP-R7");
    expect(incidentKey("SHOP", 14)).toBe("SHOP-14");
  });

  it("parses them back", () => {
    expect(parseKey("SHOP-R7")).toEqual({ appKey: "SHOP", kind: "release", number: 7 });
    expect(parseKey("SHOP-14")).toEqual({ appKey: "SHOP", kind: "incident", number: 14 });
    expect(parseKey("A1B2-R1")).toEqual({ appKey: "A1B2", kind: "release", number: 1 });
  });

  it.each(["shop-1", "SHOP", "SHOP-", "SHOP-R", "SHOP-0", "SHOP-R01", "S-1", "SHOP-1x", "SHOP-99999999999"])("rejects %s", (key) => {
    expect(parseKey(key)).toBeNull();
  });
});
