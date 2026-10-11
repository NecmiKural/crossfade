"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { type FormState, initialFormState } from "@/lib/form-state";

type Props = {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "default" | "outline" | "destructive";
  className?: string;
  children?: React.ReactNode;
  /** Render the action's returned value (e.g. a revealed token). */
  renderValue?: (value: string) => React.ReactNode;
};

/** A form bound to a server action, with inline success, error and per-field messages. */
export function ActionForm({ action, submitLabel, pendingLabel, variant = "default", className, children, renderValue }: Props) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const fieldErrors = Object.entries(state.fieldErrors ?? {}).filter(([, v]) => v?.length);
  return (
    <form action={formAction} className={className ?? "space-y-3"}>
      {children}
      {fieldErrors.length > 0 ? (
        <ul role="alert" className="space-y-0.5 text-sm text-destructive">
          {fieldErrors.map(([name, errors]) => (
            <li key={name}>
              <span className="font-mono">{name}</span>: {errors?.join(", ")}
            </li>
          ))}
        </ul>
      ) : state.message ? (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-status-promoted" : "text-sm text-destructive"}>
          {state.message}
        </p>
      ) : null}
      {state.value && renderValue ? renderValue(state.value) : null}
      <Button type="submit" variant={variant} disabled={pending}>
        {pending ? (pendingLabel ?? "Saving…") : submitLabel}
      </Button>
    </form>
  );
}
