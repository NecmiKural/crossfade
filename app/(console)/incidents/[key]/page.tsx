import Link from "next/link";
import { notFound } from "next/navigation";
import { Panel } from "@/components/panel";
import { incidentDetail } from "@/lib/console";
import { requireUser } from "@/lib/dal";
import { getDb } from "@/lib/db/client";

export default async function IncidentPage({ params }: PageProps<"/incidents/[key]">) {
  await requireUser();
  const { key } = await params;
  const detail = await incidentDetail(getDb(), key);
  if (!detail) notFound();
  const { summary } = detail;
  const open = summary.status === "open";
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link href="/board" className="legend hover:text-foreground">
          ← Board
        </Link>
        <h1 className="flex flex-wrap items-baseline gap-3 text-xl font-semibold tracking-tight">
          <span className="font-mono">{summary.key}</span>
          <span className={open ? "legend text-status-rolled-back" : "legend text-status-promoted"}>{summary.status}</span>
        </h1>
        <p className="text-sm">{summary.title}</p>
        <p className="font-mono text-xs text-muted-foreground">
          opened by{" "}
          <Link href={`/releases/${detail.openedById}`} className="underline">
            {summary.openedBy}
          </Link>
          {summary.resolvedBy && detail.resolvedById ? (
            <>
              {" "}
              · resolved by{" "}
              <Link href={`/releases/${detail.resolvedById}`} className="underline">
                {summary.resolvedBy}
              </Link>
            </>
          ) : (
            " · closes itself when a later release of the app is promoted"
          )}
        </p>
      </div>
      <Panel legend="Evidence">
        <pre className="overflow-auto rounded-lg border bg-console p-4 font-mono text-xs text-console-foreground">{JSON.stringify(detail.evidence, null, 2)}</pre>
      </Panel>
      <Panel legend="History">
        <ol className="space-y-2">
          {detail.events.map((e) => (
            <li key={e.id} className="grid grid-cols-[5.5rem_4.5rem_1fr] gap-3 text-sm">
              <time className="font-mono text-xs text-muted-foreground">{e.createdAt.toISOString().slice(11, 19)} UTC</time>
              <span className="legend">{e.actorKind}</span>
              <span>{e.message}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
