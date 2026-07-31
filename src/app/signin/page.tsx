"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { post } from "@/lib/api";
import { Button, Input, Toaster } from "@/components/ui";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("Enter a valid email address");
      return;
    }
    if (!password) {
      setError("Enter your password");
      return;
    }
    setLoading(true);
    try {
      await post("/api/auth/signin", { email, password });
      router.push("/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <Toaster />
      <div className="w-full max-w-sm rounded-md border border-ink-700 bg-ink-900 p-6">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-copper-700 bg-copper-600/20 font-mono text-sm font-bold text-copper-300">
            S
          </span>
          <span className="text-lg font-semibold text-stone-100">Swarmwright</span>
        </div>
        <h1 className="text-base font-semibold text-stone-100">Sign in</h1>
        <p className="mt-1 text-sm text-stone-500">Welcome back to your workspace.</p>
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3" noValidate>
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-stone-300">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm text-stone-300">
              Password
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <p role="alert" className="rounded-md border border-ember-500/40 bg-ember-500/10 px-3 py-2 text-sm text-ember-400">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" loading={loading} className="mt-1">
            Sign in
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-stone-500">
          No account?{" "}
          <Link href="/signup" className="text-copper-400 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
