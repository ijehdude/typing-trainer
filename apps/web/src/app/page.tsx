import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Typing Trainer</h1>
      <p className="max-w-md text-muted">
        Not another typing test. Measure where your time actually goes, get a
        diagnosis in WPM, and train exactly what holds you back.
      </p>
      <Link
        href="/session"
        className="rounded-md bg-accent px-6 py-3 font-medium text-background hover:opacity-90"
      >
        Start typing
      </Link>
      <p className="text-xs text-muted">No account needed. Nothing leaves your browser.</p>
    </main>
  );
}
