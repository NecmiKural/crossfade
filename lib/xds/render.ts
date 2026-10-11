import {
  CLUSTER_TYPE,
  EDGE_ROUTE_CONFIG,
  type EnvoyResource,
  type RenderApp,
  type RenderContext,
  type RenderVersion,
  ROUTE_CONFIGURATION_TYPE,
  TESTER_HEADER,
} from "@/lib/xds/types";

const HTTP_PROTOCOL_OPTIONS = "envoy.extensions.upstreams.http.v3.HttpProtocolOptions";
const ROUTE_TIMEOUT = "60s";
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const clusterName = (app: string, version: string): string => `${app}--${version}`;

function renderCluster(app: RenderApp, version: RenderVersion): EnvoyResource {
  const name = clusterName(app.slug, version.name);
  return {
    "@type": CLUSTER_TYPE,
    name,
    type: "STRICT_DNS",
    connect_timeout: "1s",
    per_connection_buffer_limit_bytes: 32768,
    load_assignment: {
      cluster_name: name,
      endpoints: [{ lb_endpoints: [{ endpoint: { address: { socket_address: { address: version.host, port_value: version.port } } } }] }],
    },
    health_checks: [
      {
        timeout: "1s",
        interval: "5s",
        // The 60 s default would make the health gate react a minute late.
        no_traffic_interval: "5s",
        unhealthy_threshold: 2,
        healthy_threshold: 1,
        http_health_check: { path: version.healthPath, host: app.domain },
      },
    ],
    typed_extension_protocol_options: {
      [HTTP_PROTOCOL_OPTIONS]: {
        "@type": `type.googleapis.com/${HTTP_PROTOCOL_OPTIONS}`,
        // Below Node's 5 s keep-alive, so Envoy never reuses a socket the upstream is closing.
        common_http_protocol_options: { idle_timeout: "4s" },
        explicit_http_config: { http_protocol_options: {} },
      },
    },
  };
}

export function renderClusters(ctx: RenderContext): EnvoyResource[] {
  return ctx.apps
    .flatMap((app) => app.versions.map((version) => renderCluster(app, version)))
    .sort((a, b) => byString(a.name, b.name));
}

function matchFor(app: RenderApp): Record<string, string> {
  // path_separated_prefix stops /api from also matching /apix, but it cannot be "/".
  return app.pathPrefix === "/" ? { prefix: "/" } : { path_separated_prefix: app.pathPrefix };
}

/** Hash only the leftmost X-Forwarded-For entry, so changing proxy hops do not reshuffle users (ADR-0005). */
const STICKY_HASH_POLICY = [
  { header: { header_name: "x-forwarded-for", regex_rewrite: { pattern: { regex: "^\\s*([^,\\s]+).*$" }, substitution: "\\1" } } },
];

function splitWeight(app: RenderApp): number | null {
  const release = app.release;
  if (!release || (release.status !== "rolling" && release.status !== "paused")) return null;
  return release.weight >= 1 && release.weight <= 99 ? release.weight : null;
}

function mainAction(app: RenderApp, stable: string): Record<string, unknown> {
  const weight = splitWeight(app);
  // No retry_policy: retries would hide the 5xx responses the canary gate measures.
  if (weight === null || !app.release) return { cluster: clusterName(app.slug, stable), timeout: ROUTE_TIMEOUT };
  const weighted = {
    clusters: [
      { name: clusterName(app.slug, stable), weight: 100 - weight },
      { name: clusterName(app.slug, app.release.candidate), weight },
    ],
    ...(app.sticky ? { use_hash_policy: true } : {}),
  };
  return { weighted_clusters: weighted, timeout: ROUTE_TIMEOUT, ...(app.sticky ? { hash_policy: STICKY_HASH_POLICY } : {}) };
}

/** Before any user traffic, a secret header lets testers reach the candidate. Never during the canary itself. */
function testerRoute(app: RenderApp): Record<string, unknown> | null {
  const release = app.release;
  if (!release || (release.status !== "pending_approval" && release.status !== "warming")) return null;
  return {
    name: `${app.slug}.tester`,
    match: { ...matchFor(app), headers: [{ name: TESTER_HEADER, string_match: { exact: app.testerToken } }] },
    route: { cluster: clusterName(app.slug, release.candidate), timeout: ROUTE_TIMEOUT },
    request_headers_to_remove: [TESTER_HEADER],
  };
}

function renderAppRoutes(app: RenderApp): Record<string, unknown>[] {
  if (!app.stableVersion) {
    return [
      {
        name: app.slug,
        match: matchFor(app),
        direct_response: { status: 503, body: { inline_string: `crossfade: ${app.slug} has no stable version\n` } },
      },
    ];
  }
  const tester = testerRoute(app);
  const main = { name: app.slug, match: matchFor(app), route: mainAction(app, app.stableVersion) };
  return tester ? [tester, main] : [main];
}

function byPrefixLengthThenSlug(a: RenderApp, b: RenderApp): number {
  return b.pathPrefix.length - a.pathPrefix.length || byString(a.slug, b.slug);
}

export function renderRoutes(ctx: RenderContext): EnvoyResource {
  const domains = [...new Set(ctx.apps.map((app) => app.domain))].sort(byString);
  const virtualHosts = domains.map((domain) => ({
    name: domain,
    domains: [domain],
    routes: ctx.apps
      .filter((app) => app.domain === domain)
      .sort(byPrefixLengthThenSlug)
      .flatMap(renderAppRoutes),
  }));
  const fallback = {
    name: "fallback",
    domains: ["*"],
    routes: [
      { name: "no-app", match: { prefix: "/" }, direct_response: { status: 404, body: { inline_string: "crossfade: no app for this host\n" } } },
    ],
  };
  return { "@type": ROUTE_CONFIGURATION_TYPE, name: EDGE_ROUTE_CONFIG, virtual_hosts: [...virtualHosts, fallback] };
}
