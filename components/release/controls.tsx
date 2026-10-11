"use client";

import { useActionState, useState } from "react";
import { controlAction } from "@/app/(console)/releases/[id]/actions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Control } from "@/lib/engine/actions";
import { type FormState, initialFormState } from "@/lib/form-state";

const LABELS: Record<Control, string> = { approve: "Approve", advance: "Advance", pause: "Pause", resume: "Resume", promote: "Promote now", abort: "Abort" };
const CONFIRM: Partial<Record<Control, { title: string; body: string }>> = {
  promote: { title: "Promote now?", body: "All traffic moves to the candidate immediately, skipping the remaining steps and their checks." },
  abort: { title: "Abort this release?", body: "All traffic goes back to the stable version. No incident is filed." },
};

/** Hardware-style transport controls. Only the actions that are valid now, for this person, are enabled. */
export function Controls({ id, available }: { id: string; available: readonly Control[] }) {
  const [state, action, pending] = useActionState(controlAction, initialFormState);
  // A dialog stays open only for the result it was opened on, so any new result (success or the
  // error message below the buttons) closes it without an effect.
  const [confirming, setConfirming] = useState<{ control: Control; on: FormState } | null>(null);
  const formId = `controls-${id}`;
  const order: Control[] = ["approve", "advance", "pause", "resume", "promote", "abort"];
  return (
    <div className="space-y-2">
      <form id={formId} action={action} className="flex flex-wrap gap-2">
        <input type="hidden" name="id" value={id} />
        {order.map((control) => {
          const enabled = available.includes(control) && !pending;
          const confirm = CONFIRM[control];
          const variant = control === "abort" ? "destructive" : "outline";
          if (!confirm) {
            return (
              <Button key={control} type="submit" name="control" value={control} variant={variant} disabled={!enabled} className="font-mono text-xs tracking-wider uppercase">
                {LABELS[control]}
              </Button>
            );
          }
          return (
            <AlertDialog
              key={control}
              open={confirming?.control === control && confirming.on === state}
              onOpenChange={(open) => setConfirming(open ? { control, on: state } : null)}
            >
              <AlertDialogTrigger asChild>
                <Button type="button" variant={variant} disabled={!enabled} className="font-mono text-xs tracking-wider uppercase">
                  {LABELS[control]}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
                  <AlertDialogDescription>{confirm.body}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <Button type="submit" form={formId} name="control" value={control} variant={variant} disabled={pending}>
                    {LABELS[control]}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          );
        })}
      </form>
      {state.message ? (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-status-promoted" : "text-sm text-destructive"}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
