import { JsonViewer } from "@/components/json-viewer";
import { Panel } from "@/components/panel";
import { extractAppConfig, redactSecrets } from "@/lib/core/inspect";
import type { InspectSource } from "@/lib/releases/page";
import type { ReleaseStatusView } from "@/lib/releases/view";

const pretty = (value: unknown) => redactSecrets(JSON.stringify(value, null, 2));

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="legend pt-0.5">{label}</dt>
      <dd className="font-mono text-xs">{children}</dd>
    </div>
  );
}

/**
 * Sovereign's idea, made visible: a few typed inputs on the left, the exact Envoy config they render to
 * on the right (from this release's latest publish, with secrets redacted).
 */
export function InspectPanel({ view, source }: { view: ReleaseStatusView; source: InspectSource }) {
  const stable = 100 - view.step.weight;
  const config = source.snapshot
    ? extractAppConfig({ clustersJson: source.snapshot.clusters, routesJson: source.snapshot.routes, app: view.app, domain: source.domain })
    : null;
  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <Panel legend="Inputs">
        <dl className="divide-y">
          <Row label="App">
            {view.app} · {source.domain}
            {source.pathPrefix}
          </Row>
          <Row label="Plan">
            {view.plan.id}
            <table className="mt-1 w-full text-left">
              <tbody>
                {view.plan.steps.map((s, i) => (
                  <tr key={s.weight} className={i === view.step.index && !view.terminal ? "font-semibold" : "text-muted-foreground"}>
                    <td>step {i + 1}</td>
                    <td className="tabular-nums">{s.weight}%</td>
                    <td className="tabular-nums">{s.bakeSeconds}s bake</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Row>
          <Row label="Weights">
            {view.from} {stable} / {view.candidate} {view.step.weight}
          </Row>
          <Row label="Split">{source.sticky ? "sticky (leftmost X-Forwarded-For)" : "random per request"}</Row>
          <Row label="Snapshot">
            {source.snapshot ? `rev ${source.snapshot.id} · CDS v${source.snapshot.cdsVersion} · RDS v${source.snapshot.rdsVersion}` : "not published yet"}
          </Row>
        </dl>
      </Panel>
      <Panel legend="Rendered Envoy config">
        {config ? (
          <JsonViewer
            docs={[
              { id: "routes", label: "routes", json: pretty(config.routes) },
              { id: "clusters", label: "clusters", json: pretty(config.clusters) },
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No snapshot yet.</p>
        )}
      </Panel>
    </div>
  );
}
