"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server components of the page every `intervalMs`, only while the tab is visible. */
export function AutoRefresh({ intervalMs = 2000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
