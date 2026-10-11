/** Who is acting. `readOnly` marks impersonated sessions, which may look but never change anything. */
export type Actor =
  | Readonly<{ kind: "user"; id: string; role: "admin" | "user"; readOnly: boolean }>
  | Readonly<{ kind: "apikey"; id: string; ownerId: string; apps: readonly string[] }>
  | Readonly<{ kind: "engine" }>
  | Readonly<{ kind: "system"; id?: string }>;

/** What gets written to the audit trail and snapshots ("originating identity" in OSB terms). */
export type ActorRef = Readonly<{ kind: "user" | "apikey" | "engine" | "system"; id: string | null }>;

type ReleaseFacts = Readonly<{ app: string; createdBy: string; requiresApproval: boolean }>;

export type Action =
  | Readonly<{ type: "release.read"; app: string }>
  | Readonly<{ type: "release.create"; app: string }>
  | ({ type: "release.approve" } & ReleaseFacts)
  | ({ type: "release.control"; control: "advance" | "promote" | "pause" | "resume" | "abort" } & ReleaseFacts)
  | Readonly<{ type: "edge.read" }>
  | Readonly<{ type: "app.manage" }>
  | Readonly<{ type: "app.reveal-token"; app: string }>
  | Readonly<{ type: "settings.manage" }>;

function apiKeyMay(actor: Extract<Actor, { kind: "apikey" }>, action: Action): boolean {
  // CI keys create and poll releases for the apps they are scoped to. Nothing else.
  return (action.type === "release.read" || action.type === "release.create") && actor.apps.includes(action.app);
}

function userMay(actor: Extract<Actor, { kind: "user" }>, action: Action): boolean {
  if (action.type === "release.read" || action.type === "edge.read") return true;
  if (actor.readOnly) return false;
  switch (action.type) {
    case "release.create":
      return true;
    case "release.approve":
      // Four-eyes: whoever created the release (or owns the key that did) cannot approve it.
      return action.createdBy !== actor.id;
    case "release.control": {
      const movesTraffic = action.control === "advance" || action.control === "promote";
      return !(movesTraffic && action.requiresApproval && action.createdBy === actor.id);
    }
    default:
      return actor.role === "admin";
  }
}

/** The single authorization decision; every server action and route handler goes through it. */
export function can(actor: Actor, action: Action): boolean {
  switch (actor.kind) {
    case "engine":
    case "system":
      return true;
    case "apikey":
      return apiKeyMay(actor, action);
    case "user":
      return userMay(actor, action);
  }
}

export function actorRef(actor: Actor): ActorRef {
  switch (actor.kind) {
    case "user":
    case "apikey":
      return { kind: actor.kind, id: actor.id };
    case "engine":
      return { kind: "engine", id: null };
    case "system":
      return { kind: "system", id: actor.id ?? null };
  }
}
