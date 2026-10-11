"use server";

import { revalidatePath } from "next/cache";
import { adminCreateApp, adminRegisterVersion, revealTesterToken, rotateTesterToken, updateAppSettings } from "@/lib/apps-admin";
import { requireUser, userActor } from "@/lib/dal";
import { getDb } from "@/lib/db/client";
import { field, type FormState, formFailure } from "@/lib/form-state";

const actor = async () => userActor(await requireUser());

export async function createAppAction(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const app = await adminCreateApp(getDb(), await actor(), {
      slug: field(form, "slug"),
      key: field(form, "key"),
      domain: field(form, "domain"),
      pathPrefix: field(form, "pathPrefix") || "/",
      defaultPlan: (field(form, "defaultPlan") || "standard") as "standard",
    });
    revalidatePath("/apps");
    return { ok: true, message: `${app.slug} created. Register its first version on the app page.` };
  } catch (error) {
    return formFailure(error);
  }
}

export async function registerVersionAction(_state: FormState, form: FormData): Promise<FormState> {
  const app = field(form, "app");
  try {
    const version = await adminRegisterVersion(getDb(), await actor(), {
      app,
      name: field(form, "name"),
      host: field(form, "host"),
      port: Number(field(form, "port")),
      healthPath: field(form, "healthPath") || undefined,
    });
    revalidatePath(`/apps/${app}`);
    return { ok: true, message: `${version.name} registered.` };
  } catch (error) {
    return formFailure(error);
  }
}

export async function updateSettingsAction(_state: FormState, form: FormData): Promise<FormState> {
  const app = field(form, "app");
  try {
    await updateAppSettings(getDb(), await actor(), app, { defaultPlan: field(form, "defaultPlan") as "standard", sticky: form.get("sticky") === "on" });
    revalidatePath(`/apps/${app}`);
    return { ok: true, message: "Settings saved." };
  } catch (error) {
    return formFailure(error);
  }
}

export async function rotateTokenAction(_state: FormState, form: FormData): Promise<FormState> {
  const app = field(form, "app");
  try {
    await rotateTesterToken(getDb(), await actor(), app);
    return { ok: true, message: "Tester token rotated. The old token stops working within seconds." };
  } catch (error) {
    return formFailure(error);
  }
}

export async function revealTokenAction(_state: FormState, form: FormData): Promise<FormState> {
  try {
    const token = await revealTesterToken(getDb(), await actor(), field(form, "app"));
    return { ok: true, message: "Revealed (this is recorded in the audit trail).", value: token };
  } catch (error) {
    return formFailure(error);
  }
}
