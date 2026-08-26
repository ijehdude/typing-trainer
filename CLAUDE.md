# Typing Trainer

Adaptive typing trainer per `docs/PRD.md` (the authoritative spec — formulas, constants, fixtures, acceptance criteria all live there; section references like §7.4 point into it).

## Structure

- `apps/web` — Next.js App Router app (typing surface, dashboard, API routes).
- `packages/engine` — **pure TypeScript**: no React, no browser APIs, no network, no unseeded randomness. All analysis, planning, scoring. Every tunable constant lives in `src/config.ts` only.
- `packages/content` — layouts, lexicons, corpora, priors (data + loaders).
- `supabase/migrations` — Postgres schema, RLS on every table.

## Hard rules

- The keydown input path (apps/web session page) must never allocate, await, or trigger React re-renders of the passage; see PRD §19.3.
- The engine is deterministic: generators take a seed; tests assert against the PRD's reference fixtures (§8.1 skill scores, §9.4 SRS trajectory, §7.4 closed-form counterfactual).
- Coach copy: no exclamation marks, every claim carries a measured number, templates are the primary path (LLM optional).
- The 1-minute speed-test block always uses untargeted content — it is the only trend metric.

## Commands

- `pnpm dev` — run the web app
- `pnpm test:engine` — engine unit tests (Vitest)
- `pnpm --filter web test:e2e` — Playwright
- `pnpm typecheck` / `pnpm lint` / `pnpm build`
