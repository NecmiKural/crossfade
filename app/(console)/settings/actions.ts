"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser, userActor } from "@/lib/dal";
import { getDb } from "@/lib/db/client";
import { field, type FormState, formFailure } from "@/lib/form-state";
import { addUser, createScopedKey, revokeKey } from "@/lib/settings";

const actor = async () => userActor(await requireUser());

export async function addUserAction(_state: FormState, form: FormData): Promise<FormState> {
  try {
    await addUser(
      getDb(),
      await actor(),
      { name: field(form, "name"), email: field(form, "email"), password: String(form.get("password") ?? ""), role: field(form, "role") === "admin" ? "admin" : "user" },
      new Headers(await headers()),
    );
    revalidatePath("/settings");
    return { ok: true, message: "User added. Share the password with them over a safe channel." };
  } catch (error) {
    return formFailure(error);
  }
}

export async function createKeyAction(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const created = await createScopedKey(getDb(), await actor(), { name: field(form, "name"), apps: form.getAll("apps").map(String) });
    revalidatePath("/settings");
    return { ok: true, message: "Copy the key now. It is shown only once.", value: created.key };
  } catch (error) {
    return formFailure(error);
  }
}

export async function revokeKeyAction(_state: FormState, form: FormData): Promise<FormState> {
  try {
    await revokeKey(getDb(), await actor(), field(form, "id"));
    revalidatePath("/settings");
    return { ok: true, message: "Key revoked." };
  } catch (error) {
    return formFailure(error);
  }
}
