import { describe, expect, it } from "vitest";
import { channelSeries } from "@/lib/releases/samples";

const at = (s: number) => new Date(Date.UTC(2026, 9, 11, 12, 0, s));
const sample = (s: number, stable: [number, number], candidate: [number, number], healthy = 1) => ({
  at: at(s),
  stableCompleted: stable[0],
  stableErrors: stable[1],
  candidateCompleted: candidate[0],
  candidateErrors: candidate[1],
  candidateHealthy: healthy,
});

describe("channelSeries", () => {
  it("turns cumulative counters into rolling error rates and request rates", () => {
    const series = channelSeries(
      [sample(0, [100, 0], [0, 0]), sample(2, [136, 0], [4, 1]), sample(4, [172, 0], [8, 3]), sample(6, [208, 1], [12, 4])],
      2,
    );
    expect(series.candidate.errorRates).toEqual([0.25, 0.375, 0.375]);
    expect(series.stable.errorRates).toEqual([0, 0, 1 / 72]);
    expect(series.candidate.rps).toBe(2);
    expect(series.stable.rps).toBe(18);
    expect(series.candidate.errorRate).toBe(0.375);
    expect(series.candidateHealthy).toBe(1);
  });

  it("is empty-safe and survives counter resets", () => {
    expect(channelSeries([], 5)).toMatchObject({ candidate: { errorRates: [], rps: 0, errorRate: 0 }, candidateHealthy: null });
    const reset = channelSeries([sample(0, [500, 5], [50, 5]), sample(2, [10, 0], [2, 0])], 5);
    expect(reset.candidate.errorRates).toEqual([0]);
    expect(reset.candidate.rps).toBe(0);
  });
});
