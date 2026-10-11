import { Led, type LedTone } from "@/components/led";
import { statusLabel } from "@/components/status-badge";
import { holdMessage } from "@/lib/engine/holds";
import type { ReleaseStatusView } from "@/lib/releases/view";

/** Holds that mean something is wrong; the rest are the engine waiting on purpose. */
const ALARMING = new Set(["suspected_nack", "no_live_edge", "stats_unavailable", "engine_error"]);

function lampFor(view: ReleaseStatusView): { tone: LedTone; text: string } {
  const where = view.applied ? "applied on the edge" : "applying on the edge…";
  if (view.terminal) return { tone: view.status === "promoted" ? "ok" : view.status === "rolled_back" ? "bad" : "off", text: `${statusLabel(view.status)} · ${where}` };
  if (view.status === "pending_approval") return { tone: "warn", text: "Waiting for approval by a second person" };
  if (view.hold) {
    const detail = view.hold.reason === "insufficient_data" ? ` (n=${view.analysis.n} < ${view.analysis.minRequests})` : "";
    return { tone: ALARMING.has(view.hold.reason) ? "bad" : "warn", text: `Holding: ${holdMessage(view.hold.reason)}${detail}` };
  }
  if (view.status === "warming") return { tone: "warn", text: "Warming: waiting for the candidate to pass its health checks at the edge" };
  if (view.step.phase === "applying") return { tone: "warn", text: `Applying step ${view.step.index + 1}: waiting for every Envoy node to ack (rev ${view.snapshot?.rev ?? "?"})` };
  const remaining = view.step.bakeRemainingSeconds;
  return { tone: "ok", text: `Baking${remaining === null ? "" : ` ${remaining} s`} · n=${view.analysis.n}/${view.analysis.minRequests}` };
}

/** One line that says what the release is waiting for right now. */
export function PhaseLamp({ view }: { view: ReleaseStatusView }) {
  const lamp = lampFor(view);
  return (
    <p role="status" className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 font-mono text-sm shadow-xs">
      <Led tone={lamp.tone} />
      {lamp.text}
    </p>
  );
}
