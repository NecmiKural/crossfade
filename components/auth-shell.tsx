import { Wordmark } from "@/components/wordmark";

const GATES = [
  { name: "Health gate", text: "No traffic until Envoy reports the candidate healthy." },
  { name: "Convergence gate", text: "Each step bakes only after the edge applied it." },
  { name: "Error budget", text: "Too many 5xx at the edge, and it rolls back on its own." },
] as const;

/** Split screen for sign-in and first-run setup: the console on the left, the form on the right. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-full flex-1 lg:grid-cols-[1.1fr_1fr]">
      <aside className="panel-grid relative hidden flex-col justify-between overflow-hidden bg-console p-10 text-console-foreground lg:flex">
        <Wordmark className="text-lg" />
        <div className="space-y-8">
          <p className="max-w-md text-3xl leading-tight font-semibold tracking-tight">
            Progressive delivery for plain Docker hosts.
          </p>
          <FaderArt />
          <ul className="max-w-md space-y-3">
            {GATES.map((gate) => (
              <li key={gate.name} className="grid grid-cols-[9rem_1fr] gap-3 text-sm">
                <span className="font-mono text-[11px] tracking-wider text-signal-ok uppercase">{gate.name}</span>
                <span className="text-console-muted">{gate.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="font-mono text-[11px] text-console-muted">Apache-2.0 · inspired by Atlassian&apos;s Sovereign edge control plane</p>
      </aside>
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1">
            <Wordmark className="text-base lg:hidden" />
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

/** Decorative crossfader: stable on the left, candidate on the right, the knob at 30%. */
function FaderArt() {
  return (
    <div aria-hidden className="max-w-md space-y-2">
      <div className="flex justify-between font-mono text-[11px] tracking-wider text-console-muted uppercase">
        <span>v1 · stable</span>
        <span>v2 · candidate</span>
      </div>
      <div className="relative h-10">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-console-line" />
        <div className="absolute top-1/2 left-0 h-1.5 w-[30%] -translate-y-1/2 rounded-full bg-status-rolling" />
        {[10, 50, 100].map((tick) => (
          <div key={tick} className="absolute top-0 h-2 w-px bg-console-muted" style={{ left: `${tick}%` }} />
        ))}
        <div className="absolute top-1/2 left-[30%] h-9 w-5 -translate-x-1/2 -translate-y-1/2 rounded-md border border-console-muted bg-console-foreground shadow-lg" />
      </div>
    </div>
  );
}
