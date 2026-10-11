import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { SetupForm } from "@/components/setup-form";
import { ensureCanonicalHost } from "@/lib/dal";
import { countUsers } from "@/lib/setup";

export const dynamic = "force-dynamic";

export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  const { token } = await searchParams;
  const tokenValue = typeof token === "string" ? token : "";
  await ensureCanonicalHost(tokenValue ? `/setup?token=${encodeURIComponent(tokenValue)}` : "/setup");
  if ((await countUsers()) > 0) redirect("/login");
  return (
    <AuthShell title="Create the owner account" subtitle="First run: this account becomes the admin. The link works once.">
      {tokenValue ? (
        <SetupForm token={tokenValue} />
      ) : (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          Open the setup link printed by <code className="font-mono">docker compose logs migrate</code>.
        </p>
      )}
    </AuthShell>
  );
}
