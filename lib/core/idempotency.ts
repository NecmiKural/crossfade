import { sha256Hex } from "@/lib/core/hash";

type Hashable = Readonly<{
  app: string;
  candidate: Readonly<{ name: string; host?: string; port?: number; healthPath: string }>;
  plan?: string;
  notes?: string;
}>;

/**
 * Fingerprint of a release request, so a retried PUT with the same id and body is recognized
 * (200) while the same id with a different body is a conflict (409), as in the OSB spec.
 */
export function requestHash(request: Hashable): string {
  const canonical = {
    app: request.app,
    candidate: {
      healthPath: request.candidate.healthPath,
      host: request.candidate.host ?? null,
      name: request.candidate.name,
      port: request.candidate.port ?? null,
    },
    notes: request.notes ?? null,
    plan: request.plan ?? null,
  };
  return sha256Hex(JSON.stringify(canonical));
}
