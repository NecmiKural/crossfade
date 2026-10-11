import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusBadge } from "@/components/status-badge";
import { recentReleases } from "@/lib/console";
import { getDb } from "@/lib/db/client";

export default async function BoardPage() {
  const releases = await recentReleases(getDb());
  return (
    <section aria-labelledby="board-heading" className="space-y-4">
      <AutoRefresh />
      <div className="flex items-baseline justify-between">
        <h1 id="board-heading" className="text-xl font-semibold tracking-tight">
          Releases
        </h1>
        <span className="legend">{releases.length} recent</span>
      </div>
      {releases.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          No releases yet. Start one from CI with <code className="font-mono">scripts/release.sh</code>.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {releases.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <Link href={`/releases/${r.id}`} className="font-mono text-sm font-semibold tabular-nums hover:underline">
                {r.key}
              </Link>
              <span className="text-sm">
                {r.app} <span className="text-muted-foreground">{r.from} → {r.candidate}</span>
              </span>
              <StatusBadge status={r.status} />
              <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">{r.weight}%</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
