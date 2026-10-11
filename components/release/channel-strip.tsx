import { cn } from "cn";
import { Led, type LedTone } from "@/components/led";

type Props = {
  role: "Stable" | "Candidate";
  version: string;
  rps: number;
  errorRate: number;
  errorRates: readonly number[];
  maxErrorRate: number;
  healthy: number | null;
};

const pct = (rate: number) => `${(rate * 100).toFixed(1)}%`;

function Sparkline({ values, limit }: { values: readonly number[]; limit: number }) {
  const width = 240;
  const height = 48;
  const top = Math.max(limit * 3, ...values, 0.0001);
  const y = (v: number) => height - (Math.min(v, top) / top) * (height - 4) - 2;
  const points = values.map((v, i) => `${values.length === 1 ? width : (i / (values.length - 1)) * width},${y(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-12 w-full" role="img" aria-label={`Error rate over time; limit ${pct(limit)}`}>
      <line x1="0" x2={width} y1={y(limit)} y2={y(limit)} className="stroke-status-rolled-back" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {values.length > 0 ? (
        <polyline points={points} fill="none" className="stroke-foreground" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      ) : null}
    </svg>
  );
}

/** One mixer channel per version: request rate, error LED meter, health LED and an error-rate sparkline. */
export function ChannelStrip({ role, version, rps, errorRate, errorRates, maxErrorRate, healthy }: Props) {
  const over = errorRate > maxErrorRate;
  const errorTone: LedTone = errorRates.length === 0 ? "off" : over ? "bad" : errorRate > maxErrorRate / 2 ? "warn" : "ok";
  const healthTone: LedTone = healthy === null ? "off" : healthy > 0 ? "ok" : "bad";
  return (
    <section aria-label={`${role} channel ${version}`} className="rounded-lg border bg-card p-4 shadow-xs">
      <div className="flex items-baseline justify-between">
        <p className="legend">{role}</p>
        <p className="font-mono text-sm font-semibold">{version}</p>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        <div>
          <dt className="legend">Rate</dt>
          <dd className="font-mono text-lg tabular-nums">{rps.toFixed(1)}<span className="text-xs text-muted-foreground"> rps</span></dd>
        </div>
        <div>
          <dt className="legend">Errors</dt>
          <dd className={cn("flex items-center gap-1.5 font-mono text-lg tabular-nums", over && "text-status-rolled-back")}>
            <Led tone={errorTone} />
            {pct(errorRate)}
          </dd>
        </div>
        <div>
          <dt className="legend">Health</dt>
          <dd className="flex items-center gap-1.5 font-mono text-sm">
            <Led tone={healthTone} />
            {healthy === null ? "—" : healthy > 0 ? "healthy" : "failing"}
          </dd>
        </div>
      </dl>
      <div className="mt-3">
        <Sparkline values={errorRates} limit={maxErrorRate} />
      </div>
    </section>
  );
}
