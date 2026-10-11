/** Inputs to the renderers: the Sovereign "context", loaded from Postgres in a deterministic order. */
export type RenderVersion = Readonly<{
  name: string;
  host: string;
  port: number;
  healthPath: string;
}>;

/** The in-flight (or just finished) release of an app, as far as routing cares. */
export type RenderRelease = Readonly<{
  status: "pending_approval" | "warming" | "rolling" | "paused" | "promoted" | "rolled_back" | "cancelled";
  candidate: string;
  weight: number;
}>;

export type RenderApp = Readonly<{
  slug: string;
  domain: string;
  pathPrefix: string;
  /** Versions that get an Envoy cluster (stable, in-flight and recently finished ones). */
  versions: readonly RenderVersion[];
  /** Name of the version that receives traffic when no release is in flight. */
  stableVersion: string | null;
  /** Hash each client to one side of the split (leftmost X-Forwarded-For) instead of per request. */
  sticky: boolean;
  /** Secret that lets testers reach the candidate before any user does. */
  testerToken: string;
  release: RenderRelease | null;
}>;

export type RenderContext = Readonly<{ apps: readonly RenderApp[] }>;

/** An Envoy resource as served over REST xDS: plain JSON with an "@type" discriminator. */
export type EnvoyResource = Readonly<Record<string, unknown> & { "@type": string; name: string }>;

export const CLUSTER_TYPE = "type.googleapis.com/envoy.config.cluster.v3.Cluster";
export const ROUTE_CONFIGURATION_TYPE = "type.googleapis.com/envoy.config.route.v3.RouteConfiguration";
export const EDGE_ROUTE_CONFIG = "edge";
export const RESERVED_CLUSTER_NAMES: readonly string[] = ["control-plane", "envoy-admin"];
export const TESTER_HEADER = "x-crossfade-tester";
