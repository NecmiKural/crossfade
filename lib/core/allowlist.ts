import { Hostname, Port, Slug } from "@/lib/core/schemas";

export type Upstream = Readonly<{ host: string; port: number }>;
/** App slug → upstreams that app may register as versions. Anything not listed is denied. */
export type Allowlist = ReadonlyMap<string, readonly Upstream[]>;

const PLATFORM_HOSTS = new Set(["db", "web", "engine", "envoy", "migrate", "init"]);

function fail(reason: string, entry: string): never {
  throw new Error(`UPSTREAM_ALLOWLIST: ${reason} in "${entry}"`);
}

function isReservedHost(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.startsWith("crossfade-") ||
    PLATFORM_HOSTS.has(host)
  );
}

function parseUpstream(raw: string, entry: string): Upstream {
  const match = /^(.+):(\d{1,5})$/.exec(raw.trim());
  if (!match) fail("expected host:port", entry);
  const host = Hostname.safeParse(match[1]);
  if (!host.success) fail(`invalid host "${match[1]}" (IP literals are not allowed)`, entry);
  if (isReservedHost(host.data)) fail(`reserved host "${host.data}"`, entry);
  const port = Port.safeParse(Number(match[2]));
  if (!port.success) fail(`invalid port "${match[2]}"`, entry);
  return { host: host.data, port: port.data };
}

function parseEntry(entry: string): [string, Upstream[]] {
  const eq = entry.indexOf("=");
  if (eq < 0) fail("expected app=host:port[,host:port]", entry);
  const app = Slug.safeParse(entry.slice(0, eq).trim());
  if (!app.success) fail("invalid app slug", entry);
  const items = entry.slice(eq + 1).split(",").filter((s) => s.trim() !== "");
  if (items.length === 0) fail("no upstreams", entry);
  return [app.data, items.map((item) => parseUpstream(item, entry))];
}

/** Parses `shop=shop-v1:3000,shop-v2:3000;blog=blog-blue:8080`. Throws on any invalid entry. */
export function parseAllowlist(raw: string): Allowlist {
  const list = new Map<string, Upstream[]>();
  const owners = new Map<string, string>();
  for (const entry of raw.split(";").map((s) => s.trim()).filter(Boolean)) {
    const [app, upstreams] = parseEntry(entry);
    if (list.has(app)) fail(`app "${app}" listed twice`, entry);
    for (const { host, port } of upstreams) {
      const key = `${host}:${port}`;
      const owner = owners.get(key);
      if (owner && owner !== app) fail(`upstream ${key} is listed for more than one app`, entry);
      owners.set(key, app);
    }
    list.set(app, upstreams);
  }
  return list;
}

export function isAllowed(list: Allowlist, app: string, host: string, port: number): boolean {
  const wanted = host.toLowerCase();
  return (list.get(app) ?? []).some((u) => u.host === wanted && u.port === port);
}
