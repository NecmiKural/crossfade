import { cn } from "cn";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { IncidentCard, ReleaseCard } from "@/components/board/cards";
import { buttonVariants } from "@/components/ui/button";
import { boardData, type ReleaseSummary } from "@/lib/console";
import { getDb } from "@/lib/db/client";
import type { ReleaseStatus } from "@/lib/db/schema";

type ColumnDef = { status: ReleaseStatus; title: string; stripe: string };

const IN_FLIGHT: ColumnDef[] = [
  { status: "pending_approval", title: "Pending approval", stripe: "bg-status-pending" },
  { status: "warming", title: "Warming", stripe: "bg-status-warming" },
  { status: "rolling", title: "Rolling", stripe: "bg-status-rolling" },
  { status: "paused", title: "Paused", stripe: "bg-status-paused" },
];

const FINISHED: ColumnDef[] = [
  { status: "promoted", title: "Promoted", stripe: "bg-status-promoted" },
  { status: "rolled_back", title: "Rolled back", stripe: "bg-status-rolled-back" },
  { status: "cancelled", title: "Cancelled", stripe: "bg-status-cancelled" },
];

function Column({ title, stripe, count, children, hideWhenEmpty = false }: { title: string; stripe: string; count: number; children: React.ReactNode; hideWhenEmpty?: boolean }) {
  return (
    // On phones, empty status columns are hidden so the cards that matter are on the first screen.
    <section aria-label={title} className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border bg-muted/50", hideWhenEmpty && count === 0 && "max-sm:hidden")}>
      <div className={cn("h-1", stripe)} />
      <header className="flex items-baseline justify-between px-3 py-2">
        <h2 className="legend text-foreground">{title}</h2>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{count}</span>
      </header>
      <div className="flex flex-1 flex-col gap-2 px-2 pb-2">{children}</div>
    </section>
  );
}

function Lane({ legend, columns, releases, now, className }: { legend: string; columns: ColumnDef[]; releases: ReleaseSummary[]; now: Date; className: string }) {
  return (
    <div className="space-y-2">
      <p className="legend">{legend}</p>
      <div className={cn("grid gap-3", className)}>
        {columns.map((col) => {
          const cards = releases.filter((r) => r.status === col.status);
          return (
            <Column key={col.status} title={col.title} stripe={col.stripe} count={cards.length} hideWhenEmpty>
              {cards.length === 0 ? (
                <p className="px-1 py-3 text-xs text-muted-foreground">—</p>
              ) : (
                cards.map((r) => <ReleaseCard key={r.id} release={r} now={now} />)
              )}
            </Column>
          );
        })}
      </div>
    </div>
  );
}

/** The release board: cards move between columns only on engine data, never by drag and drop. */
export default async function BoardPage() {
  const now = new Date();
  const { releases, incidents } = await boardData(getDb());
  return (
    <section aria-labelledby="board-heading" className="space-y-4">
      <AutoRefresh />
      <div className="flex items-center justify-between">
        <h1 id="board-heading" className="text-xl font-semibold tracking-tight">
          Release board
        </h1>
        <Link href="/releases/new" className={buttonVariants({ size: "sm" })}>
          Start release
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Lane legend="In flight" columns={IN_FLIGHT} releases={releases} now={now} className="sm:grid-cols-2 xl:grid-cols-4" />
          <Lane legend="Finished" columns={FINISHED} releases={releases} now={now} className="sm:grid-cols-3" />
        </div>
        <div className="space-y-2">
          <p className="legend">Incidents</p>
          <Column title="Recent" stripe="bg-foreground" count={incidents.filter((i) => i.status === "open").length}>
            {incidents.length === 0 ? (
              <p className="px-1 py-3 text-xs text-muted-foreground">No incidents.</p>
            ) : (
              incidents.map((i) => <IncidentCard key={i.id} incident={i} />)
            )}
          </Column>
        </div>
      </div>
    </section>
  );
}
