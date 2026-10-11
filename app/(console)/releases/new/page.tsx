import Link from "next/link";
import { Panel, selectClass } from "@/components/panel";
import { StartReleaseForm } from "@/components/release/start-release-form";
import { Button } from "@/components/ui/button";
import { appDetail, listApps } from "@/lib/apps-admin";
import { isAtLeastAsCautious, PLAN_IDS } from "@/lib/core/plans";
import { requireUser } from "@/lib/dal";
import { getDb } from "@/lib/db/client";

export default async function NewReleasePage({ searchParams }: PageProps<"/releases/new">) {
  await requireUser();
  const { app } = await searchParams;
  const slug = typeof app === "string" ? app : "";
  const detail = slug ? await appDetail(getDb(), slug) : undefined;
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-1">
        <Link href="/board" className="legend hover:text-foreground">
          ← Board
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Start a release</h1>
      </div>
      {detail ? <ReleaseForm detail={detail} /> : <AppPicker apps={(await listApps(getDb())).map((a) => a.slug)} />}
    </div>
  );
}

function AppPicker({ apps }: { apps: readonly string[] }) {
  return (
    <Panel legend="App">
      <form method="get" className="flex gap-2">
        <label htmlFor="app" className="sr-only">
          App
        </label>
        <select id="app" name="app" className={selectClass}>
          {apps.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Next
        </Button>
      </form>
    </Panel>
  );
}

function ReleaseForm({ detail }: { detail: NonNullable<Awaited<ReturnType<typeof appDetail>>> }) {
  const { app, versions } = detail;
  const candidates = versions.filter((v) => v.id !== app.stableVersionId).map((v) => v.name);
  const plans = PLAN_IDS.filter((p) => isAtLeastAsCautious(p, app.defaultPlan));
  const stable = versions.find((v) => v.id === app.stableVersionId)?.name ?? "none";
  return (
    <Panel legend={`${app.slug} · stable ${stable}`}>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No candidate versions. Register one on the <Link href={`/apps/${app.slug}`} className="underline">app page</Link>.
        </p>
      ) : (
        <StartReleaseForm app={app.slug} candidates={candidates} plans={plans} defaultPlan={app.defaultPlan} />
      )}
    </Panel>
  );
}
