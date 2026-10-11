import { cn } from "cn";

/** A console module: an engraved legend over a bordered panel. */
export function Panel({ legend, aside, className, children }: { legend: string; aside?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-lg border bg-card shadow-xs", className)}>
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h2 className="legend">{legend}</h2>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export const selectClass =
  "h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
