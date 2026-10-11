import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSettingsForm, RegisterVersionForm, TesterTokenControls } from "@/components/apps/forms";
import { Panel } from "@/components/panel";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { appDetail } from "@/lib/apps-admin";
import { can } from "@/lib/core/policy";
import { requireUser, userActor } from "@/lib/dal";
import { getDb } from "@/lib/db/client";

export default async function AppPage({ params }: PageProps<"/apps/[slug]">) {
  const { slug } = await params;
  const user = await requireUser();
  const detail = await appDetail(getDb(), slug);
  if (!detail) notFound();
  const { app, versions } = detail;
  const isAdmin = can(userActor(user), { type: "app.manage" });
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/apps" className="legend hover:text-foreground">
          ← Apps
        </Link>
        <h1 className="flex items-baseline gap-3 text-xl font-semibold tracking-tight">
          {app.slug}
          <span className="font-mono text-sm text-muted-foreground">{app.key}</span>
        </h1>
        <p className="font-mono text-xs text-muted-foreground">
          {app.domain}
          {app.pathPrefix} · default plan {app.defaultPlan} · {app.sticky ? "sticky" : "random"} split
          {app.requiresApproval ? " · four-eyes approval" : ""}
        </p>
        {user.readOnly ? null : (
          <Link href={`/releases/new?app=${app.slug}`} className={buttonVariants({ size: "sm", className: "mt-2" })}>
            Start release
          </Link>
        )}
      </div>
      <Panel legend="Versions">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Upstream</TableHead>
              <TableHead>Health path</TableHead>
              <TableHead className="text-right">Role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-mono text-sm font-medium">{v.name}</TableCell>
                <TableCell className="font-mono text-xs">
                  {v.host}:{v.port}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{v.healthPath}</TableCell>
                <TableCell className="text-right">
                  {v.id === app.stableVersionId ? <span className="legend text-status-promoted">stable</span> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
      {isAdmin ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel legend="Register a version">
            <RegisterVersionForm app={app.slug} />
          </Panel>
          <div className="space-y-6">
            <Panel legend="Settings">
              <AppSettingsForm app={app.slug} defaultPlan={app.defaultPlan} sticky={app.sticky} requiresApproval={app.requiresApproval} />
            </Panel>
            <Panel legend="Tester token">
              <p className="mb-3 text-sm text-muted-foreground">
                Requests with <code className="font-mono">x-crossfade-tester: &lt;token&gt;</code> reach the candidate before any user does.
              </p>
              <TesterTokenControls app={app.slug} />
            </Panel>
          </div>
        </div>
      ) : null}
    </div>
  );
}
