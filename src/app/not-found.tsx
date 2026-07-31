import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-ink-950 px-6 text-center">
      <p className="font-mono text-5xl font-semibold text-copper-500">404</p>
      <h1 className="mt-3 text-lg font-medium text-stone-200">Page not found</h1>
      <p className="mt-1 text-sm text-stone-500">The page you are looking for does not exist.</p>
      <Link
        href="/app"
        className="mt-6 inline-flex h-9 items-center rounded-md border border-ink-600 bg-ink-800 px-3.5 text-sm font-medium text-stone-200 transition-colors duration-150 ease-out hover:bg-ink-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-copper-500"
      >
        Back to workspace
      </Link>
    </main>
  );
}
