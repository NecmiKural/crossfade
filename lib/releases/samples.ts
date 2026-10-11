type Sample = Readonly<{
  at: Date;
  stableCompleted: number;
  stableErrors: number;
  candidateCompleted: number;
  candidateErrors: number;
  candidateHealthy: number;
}>;

export type Channel = Readonly<{ errorRates: number[]; rps: number; errorRate: number }>;
export type ChannelSeries = Readonly<{ stable: Channel; candidate: Channel; candidateHealthy: number | null }>;

type Pick = (s: Sample) => { completed: number; errors: number };
const stable: Pick = (s) => ({ completed: s.stableCompleted, errors: s.stableErrors });
const candidate: Pick = (s) => ({ completed: s.candidateCompleted, errors: s.candidateErrors });

/** Error rate over the window ending at sample i (counters are cumulative; resets count as zero). */
function windowRate(samples: readonly Sample[], i: number, window: number, pick: Pick): number {
  const end = pick(samples[i]);
  const start = pick(samples[Math.max(0, i - window)]);
  const n = end.completed - start.completed;
  const errors = end.errors - start.errors;
  return n > 0 && errors >= 0 ? errors / n : 0;
}

function channel(samples: readonly Sample[], window: number, pick: Pick): Channel {
  if (samples.length < 2) return { errorRates: [], rps: 0, errorRate: 0 };
  const errorRates = samples.slice(1).map((_, i) => windowRate(samples, i + 1, window, pick));
  // Request rate over the same window as the error rate, so the readout does not jump every tick.
  const last = samples[samples.length - 1];
  const first = samples[Math.max(0, samples.length - 1 - window)];
  const seconds = (last.at.getTime() - first.at.getTime()) / 1000;
  const delta = pick(last).completed - pick(first).completed;
  return { errorRates, rps: seconds > 0 && delta > 0 ? delta / seconds : 0, errorRate: errorRates[errorRates.length - 1] };
}

/** Sparkline series and current readings for the stable and candidate channel strips. */
export function channelSeries(samples: readonly Sample[], window = 5): ChannelSeries {
  return {
    stable: channel(samples, window, stable),
    candidate: channel(samples, window, candidate),
    candidateHealthy: samples.length > 0 ? samples[samples.length - 1].candidateHealthy : null,
  };
}
