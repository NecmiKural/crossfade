import { cn } from "cn";

export type LedTone = "ok" | "warn" | "bad" | "off";

const TONES: Record<LedTone, string> = {
  ok: "bg-signal-ok shadow-[0_0_6px_1px_var(--signal-ok)]",
  warn: "bg-signal-warn shadow-[0_0_6px_1px_var(--signal-warn)]",
  bad: "bg-signal-bad shadow-[0_0_6px_1px_var(--signal-bad)]",
  off: "bg-signal-off",
};

/** A console LED. Decorative: the label next to it always carries the meaning. */
export function Led({ tone, className }: { tone: LedTone; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", TONES[tone], className)} />;
}
