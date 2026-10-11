import { describe, expect, it } from "vitest";
import { requestHash } from "@/lib/core/idempotency";

const base = { app: "shop", candidate: { name: "v2", healthPath: "/healthz" } };

describe("requestHash", () => {
  it("ignores key order and treats omitted optional fields as null", () => {
    const a = requestHash({ ...base, plan: undefined, notes: undefined });
    const b = requestHash({ candidate: { healthPath: "/healthz", name: "v2" }, app: "shop" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when anything meaningful changes", () => {
    const original = requestHash(base);
    expect(requestHash({ ...base, plan: "cautious" })).not.toBe(original);
    expect(requestHash({ ...base, notes: "SHOP-12" })).not.toBe(original);
    expect(requestHash({ ...base, candidate: { ...base.candidate, name: "v3" } })).not.toBe(original);
    expect(requestHash({ ...base, candidate: { ...base.candidate, host: "shop-v2", port: 3000 } })).not.toBe(original);
  });
});
