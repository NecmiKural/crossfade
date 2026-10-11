import { getDb } from "@/lib/db/client";
import { requireSecret } from "@/lib/env";
import { readJson } from "@/lib/http";
import { errorMessage, log } from "@/lib/log";
import {
  discoveryResponse,
  EMPTY_SNAPSHOT,
  parseDiscoveryRequest,
  parseVersion,
  resourceKind,
  tokenMatches,
} from "@/lib/xds/discovery";
import { latestSnapshot, recordPoll } from "@/lib/xds/edge-store";

const empty = (status: number): Response => new Response(null, { status });

/**
 * Envoy's DiscoveryRequest lists every compiled-in extension in node.extensions, which makes it larger
 * than 64 KB. 1 MiB keeps the unauthenticated part of this endpoint bounded with plenty of headroom.
 */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * REST-JSON xDS for Envoy (POST /v3/discovery:clusters and /v3/discovery:routes).
 * Any non-200/304 answer makes Envoy keep its last good config and retry on the next poll.
 */
export async function POST(request: Request, ctx: { params: Promise<{ resource: string }> }): Promise<Response> {
  const kind = resourceKind((await ctx.params).resource);
  if (!kind) return empty(404);

  const body = await readJson(request, MAX_BODY_BYTES);
  if (body === null) return empty(413);
  const parsed = parseDiscoveryRequest(body);
  if (!parsed.ok) return empty(400);
  if (!tokenMatches(requireSecret("XDS_TOKEN"), parsed.request.token)) return empty(401);

  try {
    const db = getDb();
    const result = discoveryResponse(kind, (await latestSnapshot(db)) ?? EMPTY_SNAPSHOT, parsed.request.versionInfo);
    await recordPoll(db, {
      nodeId: parsed.request.nodeId,
      kind,
      ackedVersion: parseVersion(parsed.request.versionInfo),
      servedVersion: result.servedVersion,
      envoyVersion: parsed.request.envoyVersion,
    });
    if (result.status === 304) return empty(304);
    return new Response(result.body, { headers: { "content-type": "application/json" } });
  } catch (error) {
    log("error", "xds request failed", { kind, node: parsed.request.nodeId, error: errorMessage(error) });
    return empty(503);
  }
}
