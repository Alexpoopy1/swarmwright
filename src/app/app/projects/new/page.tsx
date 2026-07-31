"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { post } from "@/lib/api";
import { Button, Input } from "@/components/ui";

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 1) {
      setError("Enter a project name");
      return;
    }
    setBusy(true);
    try {
      const p = await post<{ id: string }>("/api/projects", {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      router.push(`/app/projects/${p.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-lg font-semibold text-stone-100">New project</h1>
      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3">
        <div>
          <label htmlFor="np-name" className="mb-1 block text-sm text-stone-300">
            Name
          </label>
          <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </div>
        <div>
          <label htmlFor="np-desc" className="mb-1 block text-sm text-stone-300">
            Description <span className="text-stone-500">(optional)</span>
          </label>
          <textarea
            id="np-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
          />
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-ember-500/40 bg-ember-500/10 px-3 py-2 text-sm text-ember-400">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={busy}>
            Create project
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
