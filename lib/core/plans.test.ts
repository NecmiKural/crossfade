import { describe, expect, it } from "vitest";
import { isAtLeastAsCautious, PLAN_IDS, PLANS } from "@/lib/core/plans";
import { ReleaseRequest, releaseRequestJsonSchema } from "@/lib/core/schemas";

describe("plan catalog", () => {
  it.each(PLAN_IDS)("%s has strictly increasing weights between 1 and 99 and sane thresholds", (id) => {
    const plan = PLANS[id];
    expect(plan.id).toBe(id);
    expect(plan.steps.length).toBeGreaterThan(0);
    plan.steps.forEach((step, i) => {
      expect(step.weight).toBeGreaterThanOrEqual(1);
      expect(step.weight).toBeLessThanOrEqual(99);
      expect(step.bakeSeconds).toBeGreaterThanOrEqual(0);
      if (i > 0) expect(step.weight).toBeGreaterThan(plan.steps[i - 1].weight);
    });
    expect(plan.minRequests).toBeGreaterThan(0);
    expect(plan.maxErrorRate).toBeGreaterThan(0);
    expect(plan.maxErrorRate).toBeLessThan(1);
    expect(plan.warmupTimeoutSeconds).toBeGreaterThan(0);
    expect(plan.insufficientDataTimeoutSeconds === null || plan.insufficientDataTimeoutSeconds > 0).toBe(true);
    expect(plan.insufficientDataTimeoutSeconds === null).toBe(!plan.autoAdvance);
  });

  it("matches the documented demo plan", () => {
    expect(PLANS.demo).toMatchObject({
      steps: [{ weight: 10, bakeSeconds: 15 }, { weight: 50, bakeSeconds: 15 }],
      minRequests: 30,
      maxErrorRate: 0.02,
      autoAdvance: true,
      warmupTimeoutSeconds: 60,
    });
    expect(PLANS.manual.autoAdvance).toBe(false);
  });

  it("ranks caution demo < standard < cautious < manual", () => {
    expect(isAtLeastAsCautious("cautious", "standard")).toBe(true);
    expect(isAtLeastAsCautious("standard", "standard")).toBe(true);
    expect(isAtLeastAsCautious("demo", "standard")).toBe(false);
    expect(isAtLeastAsCautious("manual", "cautious")).toBe(true);
  });
});

describe("ReleaseRequest", () => {
  it("accepts a candidate by name, or registers one inline with host and port", () => {
    expect(ReleaseRequest.safeParse({ app: "shop", candidate: { name: "v2" } }).success).toBe(true);
    const inline = ReleaseRequest.parse({ app: "shop", candidate: { name: "v4", host: "shop-v4", port: 3000 }, plan: "demo" });
    expect(inline.candidate.healthPath).toBe("/healthz");
  });

  it.each([
    ["host without port", { app: "shop", candidate: { name: "v4", host: "shop-v4" } }],
    ["unknown plan", { app: "shop", candidate: { name: "v2" }, plan: "yolo" }],
    ["long notes", { app: "shop", candidate: { name: "v2" }, notes: "x".repeat(2001) }],
    ["IP literal upstream", { app: "shop", candidate: { name: "v4", host: "10.0.0.1", port: 80 } }],
  ])("rejects %s", (_name, body) => {
    expect(ReleaseRequest.safeParse(body).success).toBe(false);
  });

  it("publishes a stable JSON Schema for CI clients", async () => {
    await expect(`${JSON.stringify(releaseRequestJsonSchema(), null, 2)}\n`).toMatchFileSnapshot("./__snapshots__/release-request.schema.json");
  });
});
