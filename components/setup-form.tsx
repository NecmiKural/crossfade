"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

const MESSAGES: Record<string, string> = {
  invalid_token: "This setup link is not valid. Copy it again from `docker compose logs migrate`.",
  setup_complete: "Setup is already done. Sign in instead.",
  invalid_request: "Check the fields: the password needs at least 12 characters.",
};

export function SetupForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const [name, email, password, confirm] = ["name", "email", "password", "confirm"].map((k) => String(form.get(k) ?? ""));
    if (password !== confirm) return setError("The passwords do not match.");
    setPending(true);
    setError(null);
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, name, email, password }),
    });
    if (res.status !== 201) {
      setPending(false);
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return setError(MESSAGES[body.error ?? ""] ?? "Setup failed. Check the server logs.");
    }
    // The owner exists now; if the automatic sign-in fails (say, rate limited), signing in by hand works.
    const { error: signInError } = await authClient.signIn.email({ email, password });
    router.push(signInError ? "/login" : "/board");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" autoComplete="name" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required aria-describedby="password-hint" />
        <p id="password-hint" className="text-xs text-muted-foreground">
          At least 12 characters.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating the owner account…" : "Create owner account"}
      </Button>
    </form>
  );
}
