"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-console-muted uppercase hover:text-console-foreground focus-visible:outline-2 focus-visible:outline-ring"
      onClick={async () => {
        await authClient.signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
