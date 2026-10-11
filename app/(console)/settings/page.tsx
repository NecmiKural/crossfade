import { notFound } from "next/navigation";
import { Panel } from "@/components/panel";
import { AddUserForm, CreateKeyForm, RevokeKeyButton } from "@/components/settings/forms";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listApps } from "@/lib/apps-admin";
import { can } from "@/lib/core/policy";
import { requireUser, userActor } from "@/lib/dal";
import { getDb } from "@/lib/db/client";
import { listKeys, listUsers } from "@/lib/settings";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

export default async function SettingsPage() {
  const user = await requireUser();
  if (!can(userActor(user), { type: "settings.manage" })) notFound();
  const [users, keys, apps] = await Promise.all([listUsers(getDb()), listKeys(getDb()), listApps(getDb())]);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Panel legend="Users">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.name}</TableCell>
                  <TableCell className="font-mono text-xs">{u.email}</TableCell>
                  <TableCell className="legend">{u.role ?? "user"}{u.banned ? " · banned" : ""}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{day(u.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
        <Panel legend="Add a user">
          <AddUserForm />
        </Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Panel legend="API keys">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Apps</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell>{k.name ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{k.start ?? "cf_"}…</TableCell>
                  <TableCell className="font-mono text-xs">{k.apps.join(", ") || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{k.owner ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{day(k.lastRequest)}</TableCell>
                  <TableCell className="text-right">{k.enabled ? <RevokeKeyButton id={k.id} /> : <span className="legend">revoked</span>}</TableCell>
                </TableRow>
              ))}
              {keys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    No keys yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Panel>
        <Panel legend="New API key">
          <CreateKeyForm apps={apps.map((a) => a.slug)} />
        </Panel>
      </div>
    </div>
  );
}
