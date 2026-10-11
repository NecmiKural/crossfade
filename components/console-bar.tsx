import Link from "next/link";
import { Led } from "@/components/led";
import { SignOutButton } from "@/components/sign-out-button";
import { Wordmark } from "@/components/wordmark";
import type { Lamp } from "@/lib/console";
import type { SessionUser } from "@/lib/dal";

function LampChip({ lamp }: { lamp: Lamp }) {
  return (
    <span className="inline-flex items-center gap-2 rounded border border-console-line px-2 py-1" title={lamp.detail}>
      <Led tone={lamp.tone} />
      <span className="font-mono text-[11px] tracking-wider text-console-foreground uppercase">{lamp.label}</span>
      <span className="hidden font-mono text-[11px] text-console-muted sm:inline">{lamp.detail}</span>
    </span>
  );
}

const NAV = [
  { href: "/board", label: "Board" },
  { href: "/apps", label: "Apps" },
] as const;

/** The console strip: brand, navigation, live lamps for the engine and the edge, and the user. */
export function ConsoleBar({ user, lamps }: { user: SessionUser; lamps: readonly Lamp[] }) {
  return (
    <header className="panel-grid border-b border-console-line bg-console text-console-foreground">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/board" className="rounded focus-visible:outline-2 focus-visible:outline-ring">
          <Wordmark className="text-base" />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-4">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded font-mono text-xs tracking-wider text-console-muted uppercase hover:text-console-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {lamps.map((lamp) => (
            <LampChip key={lamp.label} lamp={lamp} />
          ))}
          <span className="ml-2 hidden font-mono text-[11px] text-console-muted md:inline">
            {user.email}
            {user.readOnly ? " · read-only" : ""}
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
