import { cn } from "cn";

/** "crossfade" with a small fader glyph: a track and a knob a third of the way across. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-mono font-semibold tracking-tight", className)}>
      <svg aria-hidden viewBox="0 0 24 12" className="h-3 w-6">
        <rect x="1" y="5" width="22" height="2" rx="1" className="fill-current opacity-40" />
        <rect x="7" y="1" width="5" height="10" rx="1.5" className="fill-current" />
      </svg>
      crossfade
    </span>
  );
}
