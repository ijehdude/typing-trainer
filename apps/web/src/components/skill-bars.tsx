import type { SkillProfile } from "@typing-trainer/engine";

/** The Skill Profile display (PRD §8.1): the shape of ability, not one number. */
export function SkillBars({ profile }: { profile: SkillProfile }) {
  // A null score means we have not measured that dimension yet — say so
  // rather than drawing a bar, and never imply a perfect result (PRD §2.4:
  // if we lack the data to make a claim, we say so).
  const rows: Array<[string, string, number | null]> = [
    ["Speed", `${Math.round(profile.raw.wpmNet)} WPM`, profile.speed],
    ["Accuracy", `${(profile.raw.firstAttemptAccuracy * 100).toFixed(1)}%`, profile.accuracy],
    ["Consistency", `${Math.round(profile.consistency)}%`, profile.consistency],
    ["Rhythm", `${Math.round(profile.rhythm)}%`, profile.rhythm],
    [
      "Weak-key control",
      profile.raw.weakKeyRatio !== null && profile.raw.weakKeyRatio > 0
        ? `${(1 / profile.raw.weakKeyRatio).toFixed(2)}× gap`
        : "—",
      profile.weakKeyControl,
    ],
    [
      "Punctuation",
      profile.punctuation !== null ? `${Math.round(profile.punctuation)}` : "—",
      profile.punctuation,
    ],
  ];
  return (
    <div data-testid="skill-bars">
      <div className="space-y-2 font-mono text-sm">
        {rows.map(([label, raw, score]) => (
          <div key={label} className="flex items-center gap-3">
            <span className="w-40 shrink-0 text-muted">{label}</span>
            <span className="w-24 shrink-0 text-foreground">{raw}</span>
            {score === null ? (
              <span className="min-w-24 flex-1 text-xs text-muted">not yet measured</span>
            ) : (
              <div className="h-2 min-w-24 flex-1 overflow-hidden rounded bg-surface-2">
                <div className="h-full rounded bg-accent" style={{ width: `${Math.round(score)}%` }} />
              </div>
            )}
            <span className="w-8 text-right text-muted">{score === null ? "—" : Math.round(score)}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-baseline justify-between border-t border-border pt-3">
        <span className="text-sm text-muted">Overall typing skill</span>
        <span className="font-mono text-lg">{Math.round(profile.overall)} / 100</span>
      </div>
    </div>
  );
}
