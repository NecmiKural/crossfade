"use client";

import { createAppAction, registerVersionAction, revealTokenAction, rotateTokenAction, updateSettingsAction } from "@/app/(console)/apps/actions";
import { ActionForm } from "@/components/action-form";
import { selectClass } from "@/components/panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PLANS = ["demo", "standard", "cautious", "manual"] as const;

function Field({ name, label, hint, ...props }: React.ComponentProps<typeof Input> & { name: string; label: string; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function PlanSelect({ defaultValue = "standard" }: { defaultValue?: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor="defaultPlan">Default plan</Label>
      <select id="defaultPlan" name="defaultPlan" defaultValue={defaultValue} className={selectClass}>
        {PLANS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </div>
  );
}

export function NewAppForm() {
  return (
    <ActionForm action={createAppAction} submitLabel="Create app">
      <Field name="slug" label="Slug" placeholder="shop" required hint="Lowercase, digits and dashes." />
      <Field name="key" label="Key" placeholder="SHOP" required hint="Prefix for SHOP-R7 and SHOP-14." />
      <Field name="domain" label="Domain" placeholder="localhost" required />
      <Field name="pathPrefix" label="Path prefix" placeholder="/" />
      <PlanSelect />
    </ActionForm>
  );
}

export function RegisterVersionForm({ app }: { app: string }) {
  return (
    <ActionForm action={registerVersionAction} submitLabel="Register version" className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="app" value={app} />
      <Field name="name" label="Version" placeholder="v4" required />
      <Field name="healthPath" label="Health path" placeholder="/healthz" />
      <Field name="host" label="Upstream host" placeholder={`${app}-v4`} required hint="Must be on the operator's allowlist." />
      <Field name="port" label="Port" type="number" min={1} max={65535} placeholder="3000" required />
    </ActionForm>
  );
}

export function AppSettingsForm({ app, defaultPlan, sticky }: { app: string; defaultPlan: string; sticky: boolean }) {
  return (
    <ActionForm action={updateSettingsAction} submitLabel="Save settings">
      <input type="hidden" name="app" value={app} />
      <PlanSelect defaultValue={defaultPlan} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="sticky" defaultChecked={sticky} className="mt-0.5 size-4 accent-[var(--primary)]" />
        <span>
          Sticky split <span className="block text-xs text-muted-foreground">Each client stays on one version for the whole rollout.</span>
        </span>
      </label>
    </ActionForm>
  );
}

export function TesterTokenControls({ app }: { app: string }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <ActionForm
        action={revealTokenAction}
        submitLabel="Reveal"
        variant="outline"
        renderValue={(token) => <code className="block max-w-full break-all rounded bg-muted px-2 py-1 font-mono text-xs">{token}</code>}
      >
        <input type="hidden" name="app" value={app} />
      </ActionForm>
      <ActionForm action={rotateTokenAction} submitLabel="Rotate" variant="destructive">
        <input type="hidden" name="app" value={app} />
      </ActionForm>
    </div>
  );
}
