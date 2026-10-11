import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AutoRefresh } from "@/components/auto-refresh";
import { Panel } from "@/components/panel";
import { ChannelStrip } from "@/components/release/channel-strip";
import { Crossfader } from "@/components/release/crossfader";
import { EventTimeline } from "@/components/release/event-timeline";
import { PhaseLamp } from "@/components/release/phase-lamp";
import { StatusBadge } from "@/components/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { can } from "@/lib/core/policy";
import { requireUser, userActor } from "@/lib/dal";
import { getDb } from "@/lib/db/client";
import type { ReleaseStatus } from "@/lib/db/schema";
import { releasePageData } from "@/lib/releases/page";
import { channelSeries } from "@/lib/releases/samples";

const FILL: Record<ReleaseStatus, string> = {
  pending_approval: "bg-status-pending",
  warming: "bg-status-warming",
  rolling: "bg-status-rolling",
  paused: "bg-status-paused",
  promoted: "bg-status-promoted",
  rolled_back: "bg-status-rolled-back",
  cancelled: "bg-status-cancelled",
};

export default async function ReleasePage({ params }: PageProps<"/releases/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const user = await requireUser();
  const found = await releasePageData(getDb(), id);
  if (!found || !can(userActor(user), { type: "release.read", app: found.appSlug })) notFound();
  const { view, samples, timeline } = found.data;
  const series = channelSeries(samples);
  const outcome = view.outcome as { kind: string; reason: string; evidence: Record<string, unknown> } | null;
  return (
    <div className="space-y-6">
      {view.terminal && view.applied ? null : <AutoRefresh />}
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Link href="/board" className="legend w-full hover:text-foreground">
          ← Board
        </Link>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">{view.key}</h1>
        <Link href={`/apps/${view.app}`} className="text-sm hover:underline">
          {view.app}
        </Link>
        <StatusBadge status={view.status} />
        <span className="font-mono text-xs text-muted-foreground">
          plan {view.plan.id} · step {Math.min(view.step.index + 1, view.step.count)}/{view.step.count}
        </span>
      </header>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <Crossfader from={view.from} candidate={view.candidate} weight={view.step.weight} steps={view.plan.steps} tone={FILL[view.status]} />
      </section>

      <PhaseLamp view={view} />

      <div className="grid gap-4 md:grid-cols-2">
        <ChannelStrip role="Stable" version={view.from} {...series.stable} maxErrorRate={view.analysis.maxErrorRate} healthy={null} />
        <ChannelStrip role="Candidate" version={view.candidate} {...series.candidate} maxErrorRate={view.analysis.maxErrorRate} healthy={series.candidateHealthy} />
      </div>

      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
        </TabsList>
        <TabsContent value="timeline">
          <Panel legend="Timeline">
            <EventTimeline entries={timeline} />
          </Panel>
        </TabsContent>
        <TabsContent value="evidence">
          <Panel legend="Outcome">
            {outcome ? (
              <div className="space-y-3">
                <p className="text-sm">
                  <span className="font-medium">{outcome.kind.replace("_", " ")}</span> · {outcome.reason.replaceAll("_", " ")}
                  {view.incident ? (
                    <>
                      {" "}
                      · incident <span className="font-mono">{view.incident.key}</span> ({view.incident.status}
                      {view.incident.resolvedBy ? `, resolved by ${view.incident.resolvedBy}` : ""})
                    </>
                  ) : null}
                </p>
                <pre className="overflow-auto rounded-lg border bg-console p-4 font-mono text-xs text-console-foreground">
                  {JSON.stringify(outcome.evidence, null, 2)}
                </pre>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No verdict yet.</p>
            )}
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
