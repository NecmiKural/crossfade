"use server";

import { revalidatePath } from "next/cache";
import { requireUser, userActor } from "@/lib/dal";
import { getDb } from "@/lib/db/client";
import type { Control } from "@/lib/engine/actions";
import { field, type FormState, formFailure } from "@/lib/form-state";
import { controlRelease } from "@/lib/releases/control";

const DONE: Record<Control, string> = {
  approve: "Approved. The engine starts the rollout.",
  advance: "Advanced to the next step.",
  pause: "Paused. The error guard still rolls back if the budget is breached.",
  resume: "Resumed. The bake restarts on fresh counters.",
  promote: "Promoted.",
  abort: "Aborted. All traffic goes back to stable.",
};

export async function controlAction(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = field(form, "id");
  const control = field(form, "control") as Control;
  if (!(control in DONE)) return { ok: false, message: "Unknown action." };
  try {
    await controlRelease(getDb(), { id, control, actor: userActor(user) });
    revalidatePath(`/releases/${id}`);
    return { ok: true, message: DONE[control] };
  } catch (error) {
    return formFailure(error);
  }
}
