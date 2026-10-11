import type { EnvoyResource } from "@/lib/xds/types";

const HCM = "type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager";
const ROUTER = "type.googleapis.com/envoy.extensions.filters.http.router.v3.Router";

/** Static resources are typed messages, not Any, so the top-level "@type" must go. */
function withoutType(resource: EnvoyResource): Record<string, unknown> {
  const { "@type": _type, ...rest } = resource;
  return rest;
}

/** Embeds rendered resources in a static bootstrap so `envoy --mode validate` can check them. */
export function staticBootstrap(clusters: readonly EnvoyResource[], routeConfig: EnvoyResource): Record<string, unknown> {
  return {
    node: { id: "validate", cluster: "crossfade-edge" },
    static_resources: {
      clusters: clusters.map(withoutType),
      listeners: [
        {
          name: "edge",
          address: { socket_address: { address: "0.0.0.0", port_value: 8080 } },
          filter_chains: [
            {
              filters: [
                {
                  name: "envoy.filters.network.http_connection_manager",
                  typed_config: {
                    "@type": HCM,
                    stat_prefix: "edge",
                    route_config: withoutType(routeConfig),
                    http_filters: [{ name: "envoy.filters.http.router", typed_config: { "@type": ROUTER } }],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

export const fixtureJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
