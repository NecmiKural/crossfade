import { cn } from "cn";

type Props = { from: string; candidate: string; weight: number; steps: readonly { weight: number }[]; tone: string };

/**
 * The hero: a fader from the stable version to the candidate. The knob sits at the candidate's
 * traffic share; ticks mark the plan's steps. Motion uses transforms only and stops under reduced motion.
 */
export function Crossfader({ from, candidate, weight, steps, tone }: Props) {
  const ticks = [...steps.map((s) => s.weight), 100];
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="legend">Stable</p>
          <p className="font-mono text-lg font-semibold">{from}</p>
        </div>
        <p className="font-mono text-3xl font-semibold tabular-nums" aria-hidden>
          {weight}%
        </p>
        <div className="text-right">
          <p className="legend">Candidate</p>
          <p className="font-mono text-lg font-semibold">{candidate}</p>
        </div>
      </div>
      <div
        role="meter"
        aria-label={`Traffic to ${candidate}: ${weight}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={weight}
        className="relative h-12"
      >
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-muted shadow-inner">
          <div
            className={cn("h-full w-full origin-left rounded-full transition-transform duration-[600ms] ease-out motion-reduce:transition-none", tone)}
            style={{ transform: `scaleX(${weight / 100})` }}
          />
        </div>
        {ticks.map((t) => (
          <div key={t} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${t}%` }}>
            <span className="h-2 w-px bg-muted-foreground/60" />
          </div>
        ))}
        <div
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 transition-transform duration-[600ms] ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(${weight}%)` }}
        >
          <div className="h-10 w-6 -translate-x-1/2 rounded-md border border-foreground/20 bg-card shadow-md">
            <div className="mx-auto mt-1.5 h-7 w-0.5 rounded-full bg-foreground/70" />
          </div>
        </div>
      </div>
      <div className="relative h-4 font-mono text-[10px] text-muted-foreground">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${t}%` }}>
            {t}%
          </span>
        ))}
      </div>
    </div>
  );
}
