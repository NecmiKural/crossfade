import type { ActorRef } from "@/lib/core/policy";
import type { Tx } from "@/lib/db/client";
import { events } from "@/lib/db/schema";

export type EventInput = Readonly<{
  actor: ActorRef;
  type: string;
  message: string;
  appId?: string | null;
  releaseId?: string | null;
  incidentId?: string | null;
  data?: Record<string, unknown>;
}>;

/** Appends to the audit trail inside the caller's transaction, so the event commits with the change. */
export async function appendEvent(tx: Tx, input: EventInput): Promise<void> {
  await tx.insert(events).values({
    appId: input.appId ?? null,
    releaseId: input.releaseId ?? null,
    incidentId: input.incidentId ?? null,
    actorKind: input.actor.kind,
    actorId: input.actor.id,
    type: input.type,
    message: input.message,
    data: input.data ?? {},
  });
}
