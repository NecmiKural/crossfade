import { z } from "zod";
import { constantTimeEqual } from "@/lib/core/hash";
import { renderRoutes } from "@/lib/xds/render";
import { CLUSTER_TYPE, ROUTE_CONFIGURATION_TYPE } from "@/lib/xds/types";

export type ResourceKind = "cds" | "rds";

export type SnapshotPayload = Readonly<{ cdsVersion: number; rdsVersion: number; clusters: string; routes: string }>;

/** Served before the first snapshot exists: no clusters, only the 404 fallback virtual host. */
export const EMPTY_SNAPSHOT: SnapshotPayload = {
  cdsVersion: 0,
  rdsVersion: 0,
  clusters: "[]",
  routes: JSON.stringify([renderRoutes({ apps: [] })]),
};

export function resourceKind(segment: string): ResourceKind | null {
  if (segment === "discovery:clusters") return "cds";
  if (segment === "discovery:routes") return "rds";
  return null;
}

const BuildVersion = z
  .object({
    version: z
      .object({ major_number: z.number().optional(), minor_number: z.number().optional(), patch: z.number().optional() })
      .optional(),
  })
  .optional();

// z.object strips everything else (node.extensions, client_features, …). Field names are snake_case
// because Envoy serializes REST requests with preserve_proto_field_names.
const DiscoveryRequest = z.object({
  version_info: z.string().max(20).optional(),
  node: z.object({
    id: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
    metadata: z.object({ xds_token: z.string().max(256).optional() }).optional(),
    user_agent_build_version: BuildVersion,
  }),
});

export type ParsedRequest = Readonly<{ versionInfo: string | null; nodeId: string; token: string | null; envoyVersion: string | null }>;

export function envoyVersion(build: z.infer<typeof BuildVersion>): string | null {
  if (!build?.version) return null;
  const { major_number = 0, minor_number = 0, patch = 0 } = build.version;
  return `${major_number}.${minor_number}.${patch}`;
}

export function parseDiscoveryRequest(body: unknown): { ok: true; request: ParsedRequest } | { ok: false } {
  const parsed = DiscoveryRequest.safeParse(body);
  if (!parsed.success) return { ok: false };
  const { version_info, node } = parsed.data;
  return {
    ok: true,
    request: {
      versionInfo: version_info ?? null,
      nodeId: node.id,
      token: node.metadata?.xds_token ?? null,
      envoyVersion: envoyVersion(node.user_agent_build_version),
    },
  };
}

export function tokenMatches(expected: string, given: string | null): boolean {
  return constantTimeEqual(expected, given);
}

export function parseVersion(versionInfo: string | null): number | null {
  return versionInfo !== null && /^\d{1,16}$/.test(versionInfo) ? Number(versionInfo) : null;
}

export type DiscoveryResult = Readonly<{ status: 200 | 304; servedVersion: number; body?: string }>;

export function discoveryResponse(kind: ResourceKind, snapshot: SnapshotPayload, versionInfo: string | null): DiscoveryResult {
  const servedVersion = kind === "cds" ? snapshot.cdsVersion : snapshot.rdsVersion;
  if (versionInfo === String(servedVersion)) return { status: 304, servedVersion };
  const typeUrl = kind === "cds" ? CLUSTER_TYPE : ROUTE_CONFIGURATION_TYPE;
  const resources = kind === "cds" ? snapshot.clusters : snapshot.routes;
  // Resources are spliced in as stored: the exact bytes that were validated and hashed.
  const body = `{"version_info":"${servedVersion}","type_url":"${typeUrl}","resources":${resources}}`;
  return { status: 200, servedVersion, body };
}
