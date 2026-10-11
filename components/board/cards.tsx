import { cn } from "cn";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import type { IncidentSummary, ReleaseSummary } from "@/lib/console";

const age = (date: Date, now: Date): string => {
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 129600) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};

/** A release card: key, versions, a mini fader at the candidate's share, status and age. */
export function ReleaseCard({ release, now }: { release: ReleaseSummary; now: Date }) {
  return (
    <Link
      href={`/releases/${release.id}`}
      data-testid={`release-${release.key}`}
      className="block rounded-md border bg-card p-3 shadow-xs transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm font-semibold">{release.key}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{age(release.createdAt, now)}</span>
      </div>
      <p className="mt-1 text-sm">
        {release.app} <span className="font-mono text-xs text-muted-foreground">{release.from} → {release.candidate}</span>
      </p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full w-full origin-left bg-foreground/70" style={{ transform: `scaleX(${release.weight / 100})` }} />
      </div>
      <div className="mt-2">
        <StatusBadge status={release.status} />
      </div>
    </Link>
  );
}

export function IncidentCard({ incident }: { incident: IncidentSummary }) {
  const open = incident.status === "open";
  return (
    <Link
      href={`/incidents/${incident.key}`}
      data-testid={`incident-${incident.key}`}
      className={cn(
        "block rounded-md border bg-card p-3 shadow-xs transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring",
        open && "border-status-rolled-back/50",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm font-semibold">{incident.key}</span>
        <span className={cn("font-mono text-[11px] font-semibold tracking-wider uppercase", open ? "text-status-rolled-back" : "text-status-promoted")}>
          {open ? "open" : "resolved"}
        </span>
      </div>
      <p className="mt-1 text-sm">{incident.title}</p>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
        opened by {incident.openedBy}
        {incident.resolvedBy ? ` · resolved by ${incident.resolvedBy}` : ""}
      </p>
    </Link>
  );
}
