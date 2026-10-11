import { cn } from "cn";

export type ReleaseStatusName = "pending_approval" | "warming" | "rolling" | "paused" | "promoted" | "rolled_back" | "cancelled";

const STATUS: Record<ReleaseStatusName, { label: string; dot: string; text: string }> = {
  pending_approval: { label: "Pending approval", dot: "bg-status-pending", text: "text-status-pending" },
  warming: { label: "Warming", dot: "bg-status-warming", text: "text-status-warming" },
  rolling: { label: "Rolling", dot: "bg-status-rolling animate-pulse", text: "text-status-rolling" },
  paused: { label: "Paused", dot: "bg-status-paused", text: "text-status-paused" },
  promoted: { label: "Promoted", dot: "bg-status-promoted", text: "text-status-promoted" },
  rolled_back: { label: "Rolled back", dot: "bg-status-rolled-back", text: "text-status-rolled-back" },
  cancelled: { label: "Cancelled", dot: "bg-status-cancelled", text: "text-status-cancelled" },
};

export const statusLabel = (status: ReleaseStatusName): string => STATUS[status].label;

/** Status chip: colour plus text, never colour alone. */
export function StatusBadge({ status, className }: { status: ReleaseStatusName; className?: string }) {
  const s = STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-wider uppercase", s.text, className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full motion-reduce:animate-none", s.dot)} />
      {s.label}
    </span>
  );
}
