# Typing Trainer

**Keybr tells you what to type next. This tells you what to improve, why you are stuck, and exactly what to do about it.**

A typing trainer that behaves like a coach: it measures typing at the level of individual motor transitions, fits a causal model of where your time goes, prescribes targeted training, adapts mid-session, and remembers everything between sessions. Full product spec in [`docs/PRD.md`](docs/PRD.md).

## What's inside

- **Diagnosis Engine** — a log-IKI ridge attribution model decomposes typing time into causes (key, finger, hand transition, same-finger bigram, row jump, specific transition), each costed as counterfactual WPM ("your right pinky costs you ~4 WPM") and confidence-gated so nothing thin is ever claimed.
- **Skill Profile** — six dimensions (speed, accuracy, consistency, rhythm, weak-key control, punctuation) plus a stable composite score.
- **Motor SRS** — power-law spaced repetition graded from measured IKIs, never self-report, with an intra-session ladder.
- **Content ladder** — drills → synthetic words → real words → phrases → sentences → profile-specific prose, with evidence-based promotion gates.
- **Autopilot** — one button; the planner composes the session, adapts it at block boundaries, and keeps an untargeted speed test as the only trend metric.
- **Coach** — deterministic template voice (numbers on every claim, no cheerleading), with optional LLM narration that is validated numeral-by-numeral against the input.
- **Anonymous-first** — fully functional offline with local (IndexedDB) storage; Supabase sync and accounts are optional.

## Development

```bash
pnpm install
pnpm dev                      # web app on :3000
pnpm test:engine              # engine unit tests (Vitest)
pnpm --filter web test:e2e    # Playwright, incl. the Appendix B timing harness
pnpm typecheck && pnpm lint && pnpm build
```

Repo layout: `apps/web` (Next.js), `packages/engine` (pure TypeScript — all analysis, planning, scoring; deterministic and simulator-tested), `packages/content` (layouts, lexicon, corpora, priors), `supabase/migrations` (Postgres schema + RLS).

All backend features are optional and env-gated — see `apps/web/.env.example`.
