import {
  CLUSTER_TYPE,
  EDGE_ROUTE_CONFIG,
  type EnvoyResource,
  type RenderApp,
  type RenderContext,
  type RenderVersion,
  ROUTE_CONFIGURATION_TYPE,
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

function renderRoute(app: RenderApp): Record<string, unknown> {
  if (!app.stableVersion) {
    return {
      name: app.slug,
      match: matchFor(app),
      direct_response: { status: 503, body: { inline_string: `crossfade: ${app.slug} has no stable version\n` } },
    };
  }
  // No retry_policy: retries would hide the 5xx responses the canary gate measures.
  return { name: app.slug, match: matchFor(app), route: { cluster: clusterName(app.slug, app.stableVersion), timeout: ROUTE_TIMEOUT } };
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
      .map(renderRoute),
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
