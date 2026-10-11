import { AppError } from "@/lib/core/errors";
import { errorMessage, log } from "@/lib/log";

/** What a server action reports back to its form (useActionState). */
export type FormState = Readonly<{
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  value?: string;
}>;

export const initialFormState: FormState = { ok: false };

export function formFailure(error: unknown): FormState {
  if (error instanceof AppError) {
    const fieldErrors = error.code === "invalid_request" ? (error.details as FormState["fieldErrors"]) : undefined;
    return { ok: false, message: error.message, fieldErrors };
  }
  log("error", "server action failed", { error: errorMessage(error) });
  return { ok: false, message: "Something went wrong. Check the server logs." };
}

export const field = (form: FormData, name: string): string => String(form.get(name) ?? "").trim();
