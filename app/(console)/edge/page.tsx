import { AutoRefresh } from "@/components/auto-refresh";
import { JsonViewer } from "@/components/json-viewer";
import { Led, type LedTone } from "@/components/led";
import { Panel } from "@/components/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { edgeNodesOverview, latestSnapshotDetail } from "@/lib/console";
import { redactSecrets } from "@/lib/core/inspect";
import { getDb } from "@/lib/db/client";
import { type NodeStatus, nodeStatus } from "@/lib/xds/node-status";

const STATUS: Record<NodeStatus, { tone: LedTone; label: string }> = {
  live: { tone: "ok", label: "live" },
  applying: { tone: "warn", label: "applying" },
  suspected_nack: { tone: "bad", label: "not applied (suspected NACK)" },
  stale: { tone: "off", label: "stale" },
};

const pretty = (json: string): string => redactSecrets(JSON.stringify(JSON.parse(json), null, 2));
const ageOf = (date: Date, now: Date): string => `${Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000))} s ago`;

export default async function EdgePage() {
  const now = new Date();
  const [nodes, snapshot] = await Promise.all([edgeNodesOverview(getDb()), latestSnapshotDetail(getDb())]);
  return (
    <div className="space-y-6">
      <AutoRefresh />
      <h1 className="text-xl font-semibold tracking-tight">Edge</h1>
      <Panel legend="Envoy nodes">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Node</TableHead>
              <TableHead>Envoy</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Acked / served</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Last poll</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.flatMap((node) =>
              node.types.map((t, i) => {
                const status = STATUS[nodeStatus({ lastSeenAt: t.lastSeenAt, ackedVersion: t.acked, servedVersion: t.served, servedSince: t.servedSince, now })];
                return (
                  <TableRow key={`${node.nodeId}-${t.type}`}>
                    <TableCell className="font-mono text-sm">{i === 0 ? node.nodeId : ""}</TableCell>
                    <TableCell className="font-mono text-xs">{i === 0 ? (node.envoyVersion ?? "—") : ""}</TableCell>
                    <TableCell className="font-mono text-xs uppercase">{t.type}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">
                      {t.acked ?? "—"} / {t.served}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2 font-mono text-xs">
                        <Led tone={status.tone} />
                        {status.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">{ageOf(t.lastSeenAt, now)}</TableCell>
                  </TableRow>
                );
              }),
            )}
            {nodes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No Envoy node has polled yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          Envoy never says why it rejects REST config; it only stops advancing <code className="font-mono">version_info</code>. &ldquo;Not applied&rdquo; is
          inferred from that.
        </p>
      </Panel>
      {snapshot ? (
        <Panel
          legend={`Served config · rev ${snapshot.id}`}
          aside={<span className="font-mono text-xs text-muted-foreground">{snapshot.reason}</span>}
        >
          <p className="mb-3 font-mono text-xs text-muted-foreground">
            CDS v{snapshot.cdsVersion} · RDS v{snapshot.rdsVersion} · {snapshot.actorKind}
            {snapshot.actorId ? ` ${snapshot.actorId}` : ""} · {ageOf(snapshot.createdAt, now)}
          </p>
          <JsonViewer
            docs={[
              { id: "routes", label: "routes", json: pretty(snapshot.routes) },
              { id: "clusters", label: "clusters", json: pretty(snapshot.clusters) },
            ]}
          />
        </Panel>
      ) : null}
    </div>
  );
}
