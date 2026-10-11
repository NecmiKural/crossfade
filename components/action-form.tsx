"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
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
  const formRef = useRef<HTMLFormElement>(null);
  // React resets a form after every action, which would wipe what the person typed when the server
  // rejects it. Submitting by hand skips that reset, so the form is cleared only on success.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => formAction(form));
  }
  const fieldErrors = Object.entries(state.fieldErrors ?? {}).filter(([, v]) => v?.length);
  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className={className ?? "space-y-3"}>
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
