"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LAYOUTS } from "@typing-trainer/content";
import { db, getSettings, saveSettings, type AppSettings } from "@/lib/db";
import { drainSync, getSupabase, syncConfigured } from "@/lib/sync";

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  if (!settings) return <Shell><p className="text-muted">…</p></Shell>;

  const update = (patch: Partial<AppSettings>) => {
    void saveSettings(patch).then(setSettings);
  };

  return (
    <Shell>
      <section className="space-y-5 rounded-lg border border-border bg-surface p-8">
        <label className="block text-sm">
          <span className="text-muted">Keyboard layout</span>
          <select
            className="mt-1 w-full rounded-md border border-border bg-surface-2 p-2"
            value={settings.layoutId}
            onChange={(e) => update({ layoutId: e.target.value })}
          >
            {Object.values(LAYOUTS).map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-muted">Typing profile (what you practice for)</span>
          <select
            className="mt-1 w-full rounded-md border border-border bg-surface-2 p-2"
            value={settings.typingProfile}
            onChange={(e) => update({ typingProfile: e.target.value as AppSettings["typingProfile"] })}
          >
            <option value="developer">Developer</option>
            <option value="writer">Writer</option>
            <option value="student">Student</option>
            <option value="office">Office worker</option>
            <option value="data_entry">Data entry</option>
            <option value="gamer">Gamer</option>
            <option value="competitive">Competitive typist</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-muted">Goal (WPM)</span>
          <input
            type="number"
            className="mt-1 w-full rounded-md border border-border bg-surface-2 p-2 font-mono"
            value={settings.goalWpm ?? ""}
            min={20}
            max={200}
            onChange={(e) => update({ goalWpm: e.target.value ? Number(e.target.value) : null })}
          />
        </label>

        <label className="flex items-center justify-between text-sm">
          <span className="text-muted">Coach messages</span>
          <select
            className="rounded-md border border-border bg-surface-2 p-1.5"
            value={settings.coachMode}
            onChange={(e) => update({ coachMode: e.target.value as AppSettings["coachMode"] })}
          >
            <option value="full">Full</option>
            <option value="minimal">Minimal (numbers only)</option>
          </select>
        </label>

        <label className="flex items-center justify-between text-sm">
          <span className="text-muted">Live WPM display while typing</span>
          <input
            type="checkbox"
            checked={settings.showHud}
            onChange={(e) => update({ showHud: e.target.checked })}
          />
        </label>
      </section>

      <AccountSection />

      <section className="rounded-lg border border-border bg-surface p-8">
        <h2 className="text-xs font-medium uppercase tracking-widest text-muted">Your data</h2>
        <p className="mt-2 text-sm text-muted">
          Everything lives in this browser. Export gives you the complete raw record — sessions,
          blocks, keystroke timings, and diagnoses.
        </p>
        <div className="mt-4 flex gap-3">
          <button type="button" className="btn-ghost" onClick={() => void exportAll()}>
            Export all data (JSON)
          </button>
          {!confirmDelete ? (
            <button type="button" className="btn-ghost text-err" onClick={() => setConfirmDelete(true)}>
              Delete all data
            </button>
          ) : (
            <button
              type="button"
              className="btn-ghost border-err text-err"
              onClick={() => {
                void db.delete().then(() => {
                  router.push("/");
                });
              }}
            >
              Really delete everything?
            </button>
          )}
        </div>
      </section>
    </Shell>
  );
}

/**
 * Save-your-progress (PRD §18.2, §19.5): offered, never required. Rendered
 * only when Supabase is configured; anonymous local-only mode is the default.
 */
function AccountSection() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sent" | "signed-in">("idle");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) {
        setUserEmail(data.user.email);
        setStatus("signed-in");
        void drainSync();
      }
    });
  }, []);

  if (!syncConfigured()) return null;

  return (
    <section className="rounded-lg border border-border bg-surface p-8">
      <h2 className="text-xs font-medium uppercase tracking-widest text-muted">Account</h2>
      {status === "signed-in" ? (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span>
            Signed in as <span className="font-mono">{userEmail}</span> — your progress syncs
            automatically.
          </span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              void getSupabase()?.auth.signOut().then(() => {
                setStatus("idle");
                setUserEmail(null);
              });
            }}
          >
            Sign out
          </button>
        </div>
      ) : status === "sent" ? (
        <p className="mt-3 text-sm text-muted">
          Check your email for a sign-in link. Your local progress will migrate to the account
          automatically.
        </p>
      ) : (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const supabase = getSupabase();
            if (!supabase || !email) return;
            void supabase.auth
              .signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + "/settings" } })
              .then(() => setStatus("sent"));
          }}
        >
          <input
            type="email"
            required
            placeholder="you@example.com"
            className="flex-1 rounded-md border border-border bg-surface-2 p-2 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" className="btn-ghost">Save my progress</button>
        </form>
      )}
    </section>
  );
}

/** Full JSON export, no support ticket required (PRD §22.2). */
async function exportAll(): Promise<void> {
  const [sessions, blocks, observations, srs, kv] = await Promise.all([
    db.sessions.toArray(), db.blocks.toArray(), db.observations.toArray(),
    db.srs.toArray(), db.kv.toArray(),
  ]);
  const blob = new Blob(
    [JSON.stringify({ exportedAt: new Date().toISOString(), sessions, blocks, observations, srs, kv }, null, 2)],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `typing-trainer-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-12">
      <header className="flex items-baseline justify-between">
        <Link href="/" className="text-sm text-muted hover:text-foreground">← typing trainer</Link>
        <h1 className="text-sm uppercase tracking-widest text-muted">Settings</h1>
      </header>
      {children}
    </main>
  );
}
