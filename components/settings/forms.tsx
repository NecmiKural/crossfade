"use client";

import { addUserAction, createKeyAction, revokeKeyAction } from "@/app/(console)/settings/actions";
import { ActionForm } from "@/components/action-form";
import { selectClass } from "@/components/panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AddUserForm() {
  return (
    <ActionForm action={addUserAction} submitLabel="Add user">
      <div className="space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="password">Initial password</Label>
        <Input id="password" name="password" type="password" minLength={12} autoComplete="new-password" required />
        <p className="text-xs text-muted-foreground">At least 12 characters.</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="role">Role</Label>
        <select id="role" name="role" defaultValue="user" className={selectClass}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </div>
    </ActionForm>
  );
}

export function CreateKeyForm({ apps }: { apps: readonly string[] }) {
  return (
    <ActionForm
      action={createKeyAction}
      submitLabel="Create key"
      renderValue={(key) => <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-xs">{key}</code>}
    >
      <div className="space-y-1">
        <Label htmlFor="key-name">Name</Label>
        <Input id="key-name" name="name" placeholder="github-actions" required />
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Apps it may release</legend>
        <div className="flex flex-wrap gap-3">
          {apps.map((app) => (
            <label key={app} className="flex items-center gap-1.5 font-mono text-xs">
              <input type="checkbox" name="apps" value={app} className="size-4 accent-[var(--primary)]" />
              {app}
            </label>
          ))}
        </div>
      </fieldset>
    </ActionForm>
  );
}

export function RevokeKeyButton({ id }: { id: string }) {
  return (
    <ActionForm action={revokeKeyAction} submitLabel="Revoke" variant="destructive" className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
    </ActionForm>
  );
}
