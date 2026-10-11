import { type EnvoyResource, RESERVED_CLUSTER_NAMES } from "@/lib/xds/types";

const CLUSTER_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*--[a-z0-9]+(-[a-z0-9]+)*$/;

type WeightedCluster = { name?: unknown; weight?: unknown };
type RouteAction = { cluster?: unknown; weighted_clusters?: { clusters?: WeightedCluster[] } };
type Route = { name?: unknown; match?: Record<string, unknown>; route?: RouteAction };
type VirtualHost = { name?: unknown; domains?: unknown[]; routes?: Route[] };

function checkClusters(clusters: readonly EnvoyResource[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { name } of clusters) {
    if (seen.has(name)) problems.push(`duplicate cluster "${name}"`);
    seen.add(name);
    if (RESERVED_CLUSTER_NAMES.includes(name)) problems.push(`cluster name "${name}" is reserved`);
    else if (!CLUSTER_NAME_RE.test(name)) problems.push(`cluster name "${name}" is not <app>--<version>`);
  }
  return problems;
}

function checkWeights(route: string, entries: WeightedCluster[]): string[] {
  const weights = entries.map((e) => Number(e.weight));
  const valid = entries.length === 2 && weights.every((w) => Number.isInteger(w) && w >= 1 && w <= 99) && weights[0] + weights[1] === 100;
  return valid ? [] : [`route "${route}" weighted clusters must be exactly two entries with weights 1-99 summing to 100`];
}

function checkRoute(route: Route, known: ReadonlySet<string>): string[] {
  const name = String(route.name);
  const app = name.split(".")[0];
  const action = route.route;
  if (!action) return [];
  const weighted = action.weighted_clusters?.clusters;
  const refs = weighted ? weighted.map((e) => String(e.name)) : [String(action.cluster)];
  const problems = weighted ? checkWeights(name, weighted) : [];
  for (const ref of refs) {
    if (!known.has(ref)) problems.push(`route "${name}" references unknown cluster "${ref}"`);
    else if (!ref.startsWith(`${app}--`)) problems.push(`route "${name}" references cluster "${ref}" of another app`);
  }
  return problems;
}

function prefixLength(route: Route): number {
  const match = route.match ?? {};
  return String(match.path_separated_prefix ?? match.prefix ?? "").length;
}

function checkVirtualHost(vhost: VirtualHost, known: ReadonlySet<string>): string[] {
  const routes = vhost.routes ?? [];
  const problems = routes.flatMap((route) => checkRoute(route, known));
  routes.forEach((route, i) => {
    if (i > 0 && prefixLength(route) > prefixLength(routes[i - 1])) {
      problems.push(`virtual host "${String(vhost.name)}": route "${String(route.name)}" is shadowed by a shorter prefix before it`);
    }
  });
  return problems;
}

function checkDomains(vhosts: readonly VirtualHost[]): string[] {
  const counts = new Map<string, number>();
  for (const domain of vhosts.flatMap((v) => v.domains ?? []).map(String)) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  return [...counts].filter(([, n]) => n > 1).map(([domain]) => `domain "${domain}" appears in more than one virtual host`);
}

/**
 * Invariants a snapshot must hold before Envoy may see it. Video: with 1,000 tenants,
 * "validation is the product": no tenant may ever route to another tenant's upstream.
 */
export function validateSnapshot(clusters: readonly EnvoyResource[], routeConfig: EnvoyResource): string[] {
  const vhosts = (routeConfig.virtual_hosts ?? []) as VirtualHost[];
  const known = new Set(clusters.map((c) => c.name));
  return [...checkClusters(clusters), ...checkDomains(vhosts), ...vhosts.flatMap((v) => checkVirtualHost(v, known))];
}
