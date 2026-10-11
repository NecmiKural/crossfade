"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Doc = { id: string; label: string; json: string };

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="legend rounded px-1.5 py-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Tabbed, copyable view of rendered Envoy JSON (already redacted by the server). */
export function JsonViewer({ docs }: { docs: readonly Doc[] }) {
  return (
    <Tabs defaultValue={docs[0]?.id}>
      <TabsList>
        {docs.map((d) => (
          <TabsTrigger key={d.id} value={d.id} className="font-mono text-xs">
            {d.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {docs.map((d) => (
        <TabsContent key={d.id} value={d.id} className="relative">
          <div className="absolute top-2 right-2">
            <CopyButton text={d.json} />
          </div>
          <pre className="max-h-[32rem] overflow-auto rounded-lg border bg-console p-4 font-mono text-xs leading-relaxed text-console-foreground">
            {d.json}
          </pre>
        </TabsContent>
      ))}
    </Tabs>
  );
}
