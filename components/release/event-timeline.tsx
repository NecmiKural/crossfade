import type { TimelineEntry } from "@/lib/releases/page";

const ACTOR: Record<string, string> = { user: "user", apikey: "API key", engine: "engine", system: "system" };
const time = (d: Date) => d.toISOString().slice(11, 19);

/** The audit trail of one release, oldest first: who or what did each thing. */
export function EventTimeline({ entries }: { entries: readonly TimelineEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>;
  return (
    <ol className="space-y-2">
      {entries.map((e) => (
        <li key={e.id} className="grid grid-cols-[5.5rem_5rem_1fr] items-baseline gap-3 text-sm">
          <time dateTime={e.createdAt.toISOString()} className="font-mono text-xs text-muted-foreground tabular-nums">
            {time(e.createdAt)} UTC
          </time>
          <span className="legend">{ACTOR[e.actorKind] ?? e.actorKind}</span>
          <span>{e.message}</span>
        </li>
      ))}
    </ol>
  );
}
