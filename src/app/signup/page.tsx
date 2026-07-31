"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { post } from "@/lib/api";
import { Button, Input, Toaster } from "@/components/ui";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) {
      setError("Enter your name");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("Enter a valid email address");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      await post("/api/auth/signup", { name: name.trim(), email, password });
      router.push("/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
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
        <h1 className="text-base font-semibold text-stone-100">Create your account</h1>
        <p className="mt-1 text-sm text-stone-500">A default “Personal” workspace is created for you.</p>
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3" noValidate>
          <div>
            <label htmlFor="name" className="mb-1 block text-sm text-stone-300">
              Name
            </label>
            <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
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
              Password <span className="text-stone-500">(min 8 characters)</span>
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
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
            Create account
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-stone-500">
          Already have an account?{" "}
          <Link href="/signin" className="text-copper-400 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
