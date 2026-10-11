/** Finished releases keep their clusters this long, so routes never point at a cluster Envoy dropped. */
export const CLUSTER_GRACE_MS = 10 * 60 * 1000;

type ReleaseRef = Readonly<{ fromVersionId: string; candidateVersionId: string; finishedAt: Date | null }>;

/**
 * Which versions of an app get an Envoy cluster: the stable one, those in non-terminal releases,
 * and those in releases that finished within the grace period. Everything else is pruned from CDS.
 */
export function renderedVersionIds(input: { stableVersionId: string | null; releases: readonly ReleaseRef[]; now: Date }): Set<string> {
  const ids = new Set<string>(input.stableVersionId ? [input.stableVersionId] : []);
  for (const r of input.releases) {
    if (r.finishedAt === null || input.now.getTime() - r.finishedAt.getTime() < CLUSTER_GRACE_MS) {
      ids.add(r.fromVersionId);
      ids.add(r.candidateVersionId);
    }
  }
  return ids;
}
