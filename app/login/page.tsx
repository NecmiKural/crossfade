import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/login-form";
import { currentUser, ensureCanonicalHost } from "@/lib/dal";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  await ensureCanonicalHost("/login");
  if (await currentUser()) redirect("/board");
  return (
    <AuthShell title="Sign in" subtitle="Accounts are created by an admin. There is no public sign-up.">
      <LoginForm />
    </AuthShell>
  );
}
