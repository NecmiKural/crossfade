import Link from "next/link";
import { NewAppForm } from "@/components/apps/forms";
import { Panel } from "@/components/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listApps } from "@/lib/apps-admin";
import { can } from "@/lib/core/policy";
import { requireUser, userActor } from "@/lib/dal";
import { getDb } from "@/lib/db/client";

export default async function AppsPage() {
  const user = await requireUser();
  const isAdmin = can(userActor(user), { type: "app.manage" });
  const apps = await listApps(getDb());
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section aria-labelledby="apps-heading" className="space-y-4">
        <h1 id="apps-heading" className="text-xl font-semibold tracking-tight">
          Apps
        </h1>
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Stable</TableHead>
                <TableHead className="text-right">Versions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apps.map((app) => (
                <TableRow key={app.id}>
                  <TableCell>
                    <Link href={`/apps/${app.slug}`} className="font-medium hover:underline">
                      {app.slug}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{app.key}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {app.domain}
                    {app.pathPrefix === "/" ? "" : app.pathPrefix}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{app.stableVersion ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{app.versionCount}</TableCell>
                </TableRow>
              ))}
              {apps.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No apps yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>
      {isAdmin ? (
        <Panel legend="New app">
          <NewAppForm />
        </Panel>
      ) : null}
    </div>
  );
}
