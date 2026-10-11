"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/dal";
import { getDb } from "@/lib/db/client";
import { field, type FormState, formFailure } from "@/lib/form-state";
import { createRelease } from "@/lib/releases/create";

/** Starts a release from the console, through the same idempotent path as the CI API. */
export async function startReleaseAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = randomUUID();
  try {
    const notes = field(form, "notes");
    await createRelease(getDb(), {
      id,
      actor: { kind: "user", id: user.id, role: user.role, readOnly: user.readOnly },
      body: { app: field(form, "app"), candidate: { name: field(form, "candidate") }, plan: field(form, "plan") || undefined, notes: notes || undefined },
    });
  } catch (error) {
    return formFailure(error);
  }
  redirect(`/releases/${id}`);
}
