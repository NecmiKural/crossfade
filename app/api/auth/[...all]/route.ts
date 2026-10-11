import { getAuth } from "@/lib/auth";

/** API keys are issued only by POST /api/v1/keys (admin, app-scoped), never through Better Auth's routes. */
const BLOCKED_PREFIX = "/api/auth/api-key/";
/** What an impersonating admin may still do: leave. */
const ALLOWED_WHILE_IMPERSONATING = new Set(["/api/auth/admin/stop-impersonating", "/api/auth/sign-out"]);

async function guard(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path.startsWith(BLOCKED_PREFIX)) return Response.json({ error: "not_found" }, { status: 404 });
  if (request.method === "GET" || ALLOWED_WHILE_IMPERSONATING.has(path)) return null;
  // Impersonated sessions are read-only everywhere, including Better Auth's own account endpoints.
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (session?.session.impersonatedBy) return Response.json({ error: "read_only_impersonation" }, { status: 403 });
  return null;
}

// Handlers resolve the auth instance per request so `next build` never needs the secret.
export async function GET(request: Request): Promise<Response> {
  return (await guard(request)) ?? getAuth().handler(request);
}

export async function POST(request: Request): Promise<Response> {
  return (await guard(request)) ?? getAuth().handler(request);
}
