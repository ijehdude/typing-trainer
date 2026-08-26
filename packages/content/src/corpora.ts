/**
 * Real-world corpora for stage 5 (PRD §10.4). Every item carries source,
 * licence, and attribution (§22.3); all V1 passages are written by us
 * (licence 'ours') so the licence audit is trivial. Passages are 40–400
 * chars. Stage-5 selection is by charProfile — selection, not injection.
 */

export type Domain =
  | 'general' | 'work_email' | 'prose'
  | 'code_js' | 'code_py' | 'code_ts' | 'code_sql'
  | 'terminal' | 'numbers' | 'data_entry' | 'punctuation_heavy' | 'chat';

export interface CorpusItem {
  text: string;
  domain: Domain;
  source: string;
  licence: 'ours' | 'public-domain' | 'CC0' | 'CC-BY';
  attribution: string | null;
}

const ours = (domain: Domain, texts: string[]): CorpusItem[] =>
  texts.map((text) => ({ text, domain, source: 'typing-trainer', licence: 'ours', attribution: null }));

export const CORPUS: readonly CorpusItem[] = [
  ...ours('general', [
    "I'll send the document over tomorrow morning, once the last section is reviewed.",
    'The meeting moved to Thursday at ten, so we have two extra days to prepare the draft.',
    'She left the keys with the neighbour and took the early train into the city.',
    'The forecast says rain all weekend, which means the repairs will have to wait.',
    'Please bring the receipts from the trip so we can sort out the expenses this week.',
    'The library closes at eight on weekdays, but the reading room stays open later.',
    'He wrote the address on the back of an envelope and promptly lost the envelope.',
    'The recipe calls for two cups of flour, a pinch of salt, and far more patience than I have.',
    'Traffic was light for a Monday, and the drive across town took barely twenty minutes.',
    'They repainted the hallway over the weekend; the whole floor still smells faintly of it.',
  ]),
  ...ours('work_email', [
    'Hi Sarah, just following up on our conversation from Tuesday. Could you review the latest version before Friday?',
    'Thanks for the quick turnaround. One small request: could we align the totals with the March report?',
    'Looping in Daniel, who owns the rollout schedule. Daniel, any concerns about the June date?',
    'Quick reminder that the survey closes at noon tomorrow. It takes about four minutes to complete.',
    'The client asked for a short summary of the changes, ideally one page, before the call on Monday.',
    'I have moved our check-in to 3:30 so it does not clash with the all-hands. Same link as usual.',
    'Attached is the revised proposal with the updated pricing. Sections two and five changed the most.',
    'No action needed on your side yet; I will follow up once legal signs off on the wording.',
  ]),
  ...ours('prose', [
    'The tide went out slowly, uncovering a long ribbon of wet sand that held the sky like a mirror.',
    'By the third week the routine had settled into something almost comfortable, the way a coat softens with wear.',
    'The house at the end of the lane had been empty for years, though the garden behaved as if someone still cared.',
    'He read the letter twice, folded it carefully, and then stood for a long time at the window saying nothing.',
    'Winter arrived without ceremony that year, a grey morning like any other, except the puddles had turned to glass.',
    'What she remembered afterwards was not the argument but the silence that followed it, patient and enormous.',
    'The train crossed the river just after dawn, and for a moment the whole carriage was the colour of honey.',
    'There is a particular quiet that belongs to libraries and to snowfall, and the town that morning had both.',
  ]),
  ...ours('code_js', [
    'const user = await fetchUser(userId);\nif (!user) throw new Error("not found");',
    'const totals = orders.reduce((sum, o) => sum + o.amount, 0);',
    'export function debounce(fn, ms) {\n  let id;\n  return (...args) => {\n    clearTimeout(id);\n    id = setTimeout(() => fn(...args), ms);\n  };\n}',
    'const seen = new Set();\nfor (const item of items) {\n  if (seen.has(item.id)) continue;\n  seen.add(item.id);\n}',
    'window.addEventListener("resize", () => {\n  layout.update({ width: window.innerWidth });\n});',
    'const { data, error } = await supabase.from("sessions").select("*").eq("user_id", uid);',
  ]),
  ...ours('code_ts', [
    'interface Session {\n  id: string;\n  startedAt: number;\n  blocks: Block[];\n}',
    'function isDefined<T>(value: T | undefined): value is T {\n  return value !== undefined;\n}',
    'type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };',
    'const byId = new Map<string, User>(users.map((u) => [u.id, u]));',
    'export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));',
  ]),
  ...ours('code_py', [
    'def mean(xs):\n    return sum(xs) / len(xs) if xs else 0.0',
    'with open(path) as f:\n    rows = [line.strip().split(",") for line in f]',
    'scores = {name: compute(name) for name in names if name not in skip}',
    'class Point:\n    def __init__(self, x, y):\n        self.x = x\n        self.y = y',
    'for i, row in enumerate(rows):\n    if not row:\n        continue\n    process(row, index=i)',
  ]),
  ...ours('code_sql', [
    'select user_id, count(*) as sessions from sessions group by user_id order by sessions desc;',
    "update profiles set goal_wpm = 90 where id = '7f3a' and goal_wpm < 90;",
    'create index on session_blocks (session_id, ordinal);',
    'select s.id, b.wpm_net from sessions s join session_blocks b on b.session_id = s.id where b.kind =',
  ]),
  ...ours('terminal', [
    'git checkout -b feature/authentication',
    'pnpm install && pnpm test --filter engine',
    'curl -s https://api.example.com/v1/status | jq .uptime',
    'docker compose up -d --build web worker',
    'grep -rn "TODO" src/ --include="*.ts" | wc -l',
    'tar -czf backup-2026-08.tar.gz ./data && mv backup-2026-08.tar.gz /mnt/archive/',
  ]),
  ...ours('numbers', [
    'Invoice 2026-0417 totals $1,249.99 including 8.875% tax; due by 2026-09-15.',
    'The server at 10.24.18.53 responded in 42 ms, down from 118 ms last week.',
    'Order 3 units at $18.50 and 12 units at $4.25 for a subtotal of $106.50.',
    'Flight 447 departs at 06:35, lands at 09:12, gate B24, seat 17C.',
    'Between 1998 and 2024 the population grew from 61,400 to 87,900, a rise of 43%.',
  ]),
  ...ours('data_entry', [
    'INV-2026-08471 SGD 1,284.50 +65 6123 4567',
    'REF: AC-2210-B; QTY: 144; UNIT: 3.75; TOTAL: 540.00',
    'Case 88-3921, filed 2026-03-08, status: OPEN, assignee: R. Ortega',
    'SKU 7745-XL, bin C-12, count 36, reorder at 12',
    'TXN 004417 2026-08-25 14:32 -82.45 GROCERY OAKFIELD',
  ]),
  ...ours('punctuation_heavy', [
    '"Wait — you\'re telling me it actually works?" she asked. "Define \'works\'," he said.',
    "It wasn't the plan (there was no plan); it was luck — plus, admittedly, three rewrites.",
    'The rules are simple: show up; do the work; don\'t argue with the referee — ever.',
    "Here's the odd part: the error occurs on Tuesdays — and only Tuesdays — at 9:14 a.m.",
    'She packed everything: maps, batteries, the "good" rope, and (of course) the cat.',
  ]),
  ...ours('chat', [
    'hey are we still on for tonight? i can be there by 7 if the trains behave',
    'lol no worries, it happens. send it over when you get a chance',
    'ok so update: the thing works now. no idea why. not touching it again',
    'can you grab milk on the way back? and maybe something for dinner idk',
    'omg the demo went so well?? they asked for a second meeting next week',
  ]),
];

export interface CharProfile {
  /** Set of characters the passage contains. */
  chars: Set<string>;
  /** Bigram counts within the passage. */
  bigrams: Map<string, number>;
  length: number;
}

export function charProfile(text: string): CharProfile {
  const chars = new Set<string>();
  const bigrams = new Map<string, number>();
  for (let i = 0; i < text.length; i++) {
    chars.add(text[i]!);
    if (i > 0) {
      const bg = text[i - 1]! + text[i]!;
      bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
    }
  }
  return { chars, bigrams, length: text.length };
}

export function corpusByDomain(domain: Domain): CorpusItem[] {
  return CORPUS.filter((c) => c.domain === domain);
}

// --- Typing Profiles (PRD §3.4, §10.4 domain mixes) -----------------------

export type TypingProfileId =
  | 'developer' | 'writer' | 'student' | 'office' | 'data_entry' | 'gamer' | 'competitive';

export const PROFILE_MIX: Record<TypingProfileId, Partial<Record<Domain, number>>> = {
  developer: { code_ts: 0.20, code_js: 0.15, code_py: 0.05, code_sql: 0.05, terminal: 0.15, general: 0.20, punctuation_heavy: 0.10, numbers: 0.10 },
  writer: { prose: 0.50, general: 0.25, punctuation_heavy: 0.20, numbers: 0.05 },
  student: { prose: 0.35, general: 0.30, punctuation_heavy: 0.20, numbers: 0.15 },
  office: { work_email: 0.45, general: 0.25, numbers: 0.20, punctuation_heavy: 0.10 },
  data_entry: { data_entry: 0.50, numbers: 0.35, general: 0.15 },
  gamer: { chat: 0.45, general: 0.35, punctuation_heavy: 0.20 },
  competitive: { prose: 0.40, general: 0.40, punctuation_heavy: 0.20 },
};
