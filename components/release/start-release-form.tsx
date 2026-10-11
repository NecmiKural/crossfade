"use client";

import { startReleaseAction } from "@/app/(console)/releases/actions";
import { ActionForm } from "@/components/action-form";
import { selectClass } from "@/components/panel";
import { Label } from "@/components/ui/label";

type Props = { app: string; candidates: readonly string[]; plans: readonly string[]; defaultPlan: string };

export function StartReleaseForm({ app, candidates, plans, defaultPlan }: Props) {
  return (
    <ActionForm action={startReleaseAction} submitLabel="Start release" pendingLabel="Starting…">
      <input type="hidden" name="app" value={app} />
      <div className="space-y-1">
        <Label htmlFor="candidate">Candidate version</Label>
        <select id="candidate" name="candidate" className={selectClass} required>
          {candidates.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="plan">Plan</Label>
        <select id="plan" name="plan" defaultValue={defaultPlan} className={selectClass}>
          {plans.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">Only plans at least as cautious as the app default ({defaultPlan}).</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <textarea id="notes" name="notes" maxLength={2000} rows={3} placeholder="SHOP-12 checkout fix" className={`${selectClass} h-auto py-2`} />
      </div>
    </ActionForm>
  );
}
