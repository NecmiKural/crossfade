import { ConsoleBar } from "@/components/console-bar";
import { edgeLamp, engineLamp } from "@/lib/console";
import { ensureCanonicalHost, requireUser } from "@/lib/dal";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: LayoutProps<"/">) {
  await ensureCanonicalHost("/board");
  const user = await requireUser();
  const lamps = await Promise.all([engineLamp(getDb()), edgeLamp(getDb())]);
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <ConsoleBar user={user} lamps={lamps} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
