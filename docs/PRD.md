# Typing Trainer — Product Requirements Document

**Product codename:** Typing Trainer (working title)
**Repository:** https://github.com/ijehdude/typing-trainer
**Hosting:** Vercel
**Owner:** ijehdude
**Status:** Draft v1.0
**Last updated:** 2026-08-26

---

## How to read this document

This PRD is written to be implemented by an AI coding agent (Claude Code) working directly in the repository. It therefore does two jobs at once:

1. **Product definition** — what we are building, for whom, and why (§1–§5).
2. **Engineering specification** — algorithms, formulas, data model, and acceptance criteria precise enough to code against without further interpretation (§6–§20).

Where a number appears (a threshold, a weight, an interval), it is a **tunable default**, not a law. Every such constant lives in a single configuration module (`engine/config.ts`) so that tuning never requires touching logic. Constants are marked `⚙️` on first appearance.

Anything explicitly deferred is marked **[V2]** or **[V3]** and specified only to the depth needed to avoid painting V1 into a corner.

---

## Table of contents

1. [Vision](#1-vision)
2. [Problem and positioning](#2-problem-and-positioning)
3. [Target users](#3-target-users)
4. [Goals, non-goals, success metrics](#4-goals-non-goals-success-metrics)
5. [Core concepts and vocabulary](#5-core-concepts-and-vocabulary)
6. [Measurement layer: what we capture](#6-measurement-layer-what-we-capture)
7. [The Diagnosis Engine](#7-the-diagnosis-engine)
8. [The Skill Profile](#8-the-skill-profile)
9. [Spaced repetition for motor patterns](#9-spaced-repetition-for-motor-patterns)
10. [The Content Engine](#10-the-content-engine)
11. [The Curriculum](#11-the-curriculum)
12. [Autopilot: the session planner](#12-autopilot-the-session-planner)
13. [Real-time adaptation](#13-real-time-adaptation)
14. [Coach Mode and "Why am I stuck?"](#14-coach-mode-and-why-am-i-stuck)
15. [Bad-habit detection](#15-bad-habit-detection)
16. [Training modes and visibility modes](#16-training-modes-and-visibility-modes)
17. [Progression, milestones, achievements](#17-progression-milestones-achievements)
18. [UX and information architecture](#18-ux-and-information-architecture)
19. [Technical architecture](#19-technical-architecture)
20. [Data model](#20-data-model)
21. [Non-functional requirements](#21-non-functional-requirements)
22. [Privacy, security, content licensing](#22-privacy-security-content-licensing)
23. [Roadmap and acceptance criteria](#23-roadmap-and-acceptance-criteria)
24. [Risks and open questions](#24-risks-and-open-questions)
25. [Appendices](#25-appendices)

---

## 1. Vision

**Keybr tells you what to type next. This app tells you what to improve, why you are struggling, and exactly what to do about it.**

A typing trainer that behaves like a personal coach rather than a text generator. It measures your typing at the level of individual motor transitions, builds a causal model of where your time actually goes, prescribes targeted training, adapts that training mid-session as you improve, and remembers everything between sessions so that each visit continues the last.

The user should be able to open the app, press one button, type for fifteen minutes, and get measurably faster — without ever needing to understand typing science, choose a lesson, or interpret a graph.

**One-line positioning:** *Strava for typing* — not another typing test.

**Elevator pitch (marketing copy):**
> A typing trainer that helps you improve your speed and accuracy through interactive exercises, real-time feedback, and progress tracking. Practice at your own pace, build muscle memory, and become a faster, more confident typist.

---

## 2. Problem and positioning

### 2.1 What existing products do well

| Product | Strength | Weakness we exploit |
|---|---|---|
| **Keybr** | Genuinely strong adaptive core: per-key statistics, progressive letter unlocking, generated pseudo-words targeting weak keys, target-speed progression | Measures keys, not motor transitions. Tells you *what* to type but never *why* you are slow. No curriculum, no memory of your training arc, no real-world text, ads, dated UX |
| **Monkeytype** | Excellent feel, latency, and consistency metrics; strong customization; beloved by enthusiasts | It is a *test*, not a trainer. No diagnosis, no prescription, no progression |
| **TypingClub / Typing.com** | Structured curriculum, good for absolute beginners | Rigid and school-flavoured. Not adaptive. Adults abandon it |
| **10FastFingers / Nitro Type** | Fun, social | Pure entertainment; childish framing; no learning model |

### 2.2 The gap

There is an unoccupied position between **adaptive-but-directionless** (Keybr) and **structured-but-rigid** (TypingClub):

> An adaptive system with an explicit, explainable training plan that a motivated adult can trust.

Nobody currently answers the single most valuable question a plateaued typist has: **"Why am I stuck at 72 WPM, and what specifically do I do about it?"**

### 2.3 The three differentiators

Everything else in this document supports one of these three:

**D1 — Diagnosis, not description.** We decompose typing time into attributable causes (this key, this finger, this transition, this speed-accuracy tradeoff) and quantify each in WPM. "Your right pinky is costing you ~7 WPM" is a claim no competitor makes.

**D2 — Coaching continuity.** The app has memory and intent. It opens with "Yesterday we identified your `i → o` transition as a bottleneck. Let's fix it." Sessions are chapters in a plan, not isolated tests.

**D3 — Autopilot.** One button. The system decides the entire session, adapts it live, and reports what changed. Zero decisions required from the user.

### 2.4 Explicit anti-goals for the experience

- No ads, ever.
- No cartoon cars, confetti explosions, or "🎉 YOU TYPED 10 WORDS!!!". The tone is a serious training tool for adults — closer to a strength-training log than a mobile game.
- No wall of settings on first run. Configurability exists but is never a prerequisite to value.
- No dishonest metrics. If we do not have enough data to make a claim, we say so rather than inventing one (see §7.7 Confidence gating).

---

## 3. Target users

### 3.1 Primary persona — "The Plateaued Professional"

Adult, 25–45, types 60–90 WPM, self-taught touch typist, types for a living (developer, writer, analyst, support). Has plateaued for months. Has tried Keybr and Monkeytype, improved a little, then stopped because progress became invisible. **Wants:** a reason to believe the next 15 minutes will actually help. **Success feels like:** a diagnosis they had never considered, followed by a measurable gain in two weeks.

### 3.2 Secondary persona — "The Converting Hunt-and-Pecker"

Adult, types 30–45 WPM with 4 fingers and constant keyboard-watching. Knows they should learn touch typing but every course starts with `fff jjj fff` and feels like being sent back to primary school. **Wants:** a fast, dignified path to real touch typing. **Success feels like:** typing their first paragraph without looking.

### 3.3 Tertiary persona — "The Optimizer"

Types 100+ WPM. Wants to reach 130+. Cares about consistency, burst speed, rare bigrams, punctuation, and code. **Wants:** granular data and hard challenges. **Success feels like:** finding the 3 transitions holding back their ceiling.

### 3.4 Typing Profiles (a product feature, not just a persona)

At onboarding the user picks a **Typing Profile**, which determines the real-world corpus mix used in Fluency-stage training (§10.4):

`Developer` · `Writer` · `Student` · `Office worker` · `Data entry` · `Gamer` · `Multilingual` **[V2]** · `Competitive typist`

The profile is changeable at any time and can be blended (e.g. 60% Developer / 40% Office worker).

---

## 4. Goals, non-goals, success metrics

### 4.1 Product goals

| # | Goal |
|---|---|
| G1 | A user can start a genuinely personalized, effective session within 10 seconds of landing, with zero configuration |
| G2 | Every session ends with a specific, quantified, actionable diagnosis |
| G3 | A returning user perceives explicit continuity from their last session |
| G4 | Measurable typing improvement: median +8 WPM or +1.5pp accuracy after 20 sessions for users starting under 80 WPM |
| G5 | The system never makes a claim it cannot support from data |

### 4.2 Non-goals

- Mobile / on-screen keyboard typing training (desktop-first; mobile gets read-only dashboard).
- Non-Latin scripts, CJK IME training. **[V3]**
- Teaching alternative layouts from scratch (we *support* Dvorak/Colemak input, we do not run a layout-migration curriculum until **[V2]**).
- Being a social network. Duels are **[V2]** and remain a mode, not the product.
- Proctored certification / employment testing.

### 4.3 Success metrics

**North star:** *Weekly Improving Users* — users who completed ≥3 sessions this week **and** whose 7-day trailing skill score is above their previous 7-day trailing skill score.

| Metric | V1 target |
|---|---|
| Onboarding completion (landing → first completed session) | ≥ 55% |
| D1 / D7 / D30 retention | 40% / 22% / 12% |
| Median sessions per active user per week | ≥ 3 |
| Median session length | 12–18 min |
| Autopilot usage share of all sessions | ≥ 70% |
| "Why am I stuck?" → next-session completion rate | ≥ 65% |
| Median WPM gain over 20 sessions (sub-80 WPM cohort) | ≥ +8 WPM |
| Diagnosis usefulness (in-app thumb rating on session report) | ≥ 75% positive |

---

## 5. Core concepts and vocabulary

These terms are used precisely throughout. They are also the names used in code.

| Term | Definition |
|---|---|
| **Keystroke** | A single `keydown` with its timing, expected character, actual character, and correctness |
| **IKI** (inter-keystroke interval) | Milliseconds between the `keydown` of one correct character and the `keydown` of the next. The atomic unit of all analysis |
| **Transition** | An ordered pair of characters `(a → b)`; the thing an IKI actually measures. A bigram |
| **Pattern** | A trainable unit: a key, a transition, a trigram, a word, or a class (e.g. "right-pinky keys", "digits") |
| **Drill** | A short generated text targeting one or more patterns |
| **Block** | One contiguous segment of a session with a single objective, generator config, duration, and exit criteria |
| **Session** | An ordered set of blocks, usually 8–20 minutes |
| **Plan** | The multi-session training arc produced by the Planner |
| **Skill Profile** | The six-dimension vector (§8) plus a composite 0–100 score |
| **Mastery state** | Per-pattern SRS state: stability, difficulty, last review, due time |
| **Stage** | Position in the content ladder: `drill → synthetic → words → phrases → sentences → prose` |
| **Track** | Curriculum area: `Foundations → Control → Speed → Fluency → Mastery` |
| **Visibility mode** | How much visual assistance is given (§16.2) |
| **Diagnosis** | A ranked, quantified set of Findings with an attached Prescription |
| **Finding** | `{ cause, evidence, estimated WPM cost, confidence }` |
| **Prescription** | A concrete block recipe that addresses a Finding |

---

## 6. Measurement layer: what we capture

Everything downstream depends on this being correct. Get this wrong and the whole product is fiction.

### 6.1 The keystroke record

For every `keydown` during an active block, capture:

```ts
interface Keystroke {
  t: number;            // performance.now() at keydown, ms, float
  tUp: number | null;   // performance.now() at keyup (dwell time), null if never released cleanly
  code: string;         // KeyboardEvent.code — physical key, layout-independent
  key: string;          // KeyboardEvent.key — produced character
  expected: string;     // character the user should have produced at this position
  index: number;        // position in the block's target text
  correct: boolean;
  isCorrection: boolean;// Backspace or correction of a prior error
  repeat: boolean;      // KeyboardEvent.repeat — held-key auto-repeat
  modifiers: number;    // bitfield: shift|ctrl|alt|meta
}
```

**Derived per keystroke at capture time:** `hand`, `finger`, `row`, `column` — resolved through the active **layout map** (§6.5) from `code`, not from `key`.

### 6.2 Timing correctness requirements

These are hard requirements; violations silently corrupt every metric.

1. Use `event.timeStamp` where it is a `DOMHighResTimeStamp`, else `performance.now()` read **synchronously inside the handler**. Never `Date.now()`. Never a timestamp taken after any `await`, state update, or render.
2. The keydown handler must do nothing but push to a preallocated ring buffer and schedule a render. All analysis is deferred (§19.4).
3. Discard from IKI statistics: `repeat === true` keystrokes; IKI < `15 ms` ⚙️ (key rollover / hardware artifacts); IKI > `2000 ms` ⚙️ (the user got up, sneezed, read a message). Discarded keystrokes are still recorded, just flagged `excludedFromTiming`.
4. Pause detection: any gap > `2000 ms` ⚙️ splits the block's timing into segments and does not count toward elapsed time for WPM.
5. Ignore `keydown` while `document.hidden` or the input surface is unfocused; auto-pause the block.
6. Composition events (`compositionstart/end`) suspend capture. IME input is out of scope for V1 and must fail safe, not fail dirty.
7. Clock hygiene: `performance.now()` is monotonic within a document; never mix it with wall-clock. Store session wall-clock start once, everything else as offsets.

### 6.3 Error model

An error is a keystroke where `key !== expected`. We distinguish:

| Error type | Definition | Why it matters |
|---|---|---|
| **Substitution** | Wrong character produced | The default case |
| **Transposition** | Characters `n` and `n+1` typed in swapped order | Classic speed error; indicates timing not knowledge |
| **Insertion** | Extra character not in target | Often finger tremor or rollover |
| **Omission** | Character skipped | Often on weak fingers |
| **Adjacent-key** | Substituted character is physically adjacent | Motor imprecision |
| **Same-finger** | Substituted character uses the same finger | Finger confusion |
| **Mirror** | Substituted character is the mirrored key on the other hand | Hand confusion — a learning-stage marker |

Error typing is computed at analysis time from the layout map. Each error carries `errorType`.

### 6.4 Input policy (correctness mode)

Two settings ⚙️, default **Stop-on-error = off, Backspace = allowed**:

- **Free mode (default):** errors are shown in red, user may continue or backspace. Realistic; matches Monkeytype.
- **Strict mode:** the caret does not advance until the correct key is pressed. Used in Precision mode (§16.1) and in Foundations (§11).

Both modes must produce identical, comparable statistics. Errors are counted at first attempt on each position regardless of later correction.

### 6.5 Layout support

- V1 ships `QWERTY-US`, `QWERTY-UK`, `Dvorak`, `Colemak`, `Colemak-DH`.
- A layout is a data file mapping `KeyboardEvent.code → { char, shiftChar, hand, finger, row, col, homeDistance }`.
- Detection: try `navigator.keyboard.getLayoutMap()` where available; otherwise prompt during calibration with a 6-key probe ("press the key to the right of L").
- Finger assignment follows standard touch-typing assignment for the layout; users may override the assignment for the pinky/ring columns ⚙️.

### 6.6 What we do NOT measure (and must not claim)

We cannot see the user's hands. Therefore we **never assert** finger substitution, wrist posture, or which finger physically pressed a key. We infer *statistically likely* patterns and phrase them as hypotheses ("this pattern is consistent with visually searching for the key"), never as observations. See §15.4.

---

## 7. The Diagnosis Engine

This is the core intellectual property of the product. Everything else is presentation.

### 7.1 The central insight

Per-key statistics are a category error. An IKI is a property of a **transition**, not a key. When Keybr says "your `p` is slow", what it actually measured is the time from *some previous key* to `p`, averaged over whatever contexts happened to occur. That average conflates at least six different effects.

We separate them.

### 7.2 The attribution model

We model the log of the inter-keystroke interval as an additive sum of effects:

```
log(IKI) = μ
         + κ_target(b)          // intrinsic cost of hitting key b
         + φ_finger(f(b))       // finger effect (8 fingers + thumbs)
         + η_hand(h(a), h(b))   // hand transition: same-hand vs alternating
         + σ_sfb(a, b)          // same-finger bigram penalty
         + ρ_row(|row(a)-row(b)|) // row-jump distance penalty
         + δ_bigram(a, b)       // residual specific to this transition
         + ε                    // noise
```

**Why log:** IKI distributions are right-skewed and roughly log-normal; effects are multiplicative (a slow finger makes everything ~15% slower, not ~30ms slower); log keeps the model linear and the effects interpretable as percentages.

**Fitting:** ridge regression (L2, λ = `1.0` ⚙️) via online stochastic gradient descent, or batch-refit over the last `N = 20,000` ⚙️ retained IKIs. Refit at the end of each block in a Web Worker (§19.4). Coefficients persist to `model_params` (§20).

**Priors / cold start:** coefficients are initialized from a population prior shipped as a data file (derived initially from published keystroke-dynamics literature and our own synthetic baseline, then replaced by aggregated anonymous user data once we have volume). Ridge shrinks a new user's estimates toward this prior, which is exactly the behaviour we want when data is thin.

**Regularization of `δ_bigram`:** stronger penalty (λ_δ = `4.0` ⚙️) so that a transition must be *consistently* anomalous across many observations before it earns its own coefficient. This is what stops the engine from hallucinating bottlenecks.

### 7.3 From coefficients to WPM

The bridge between IKI and WPM:

```
WPM = 12 / m        where m = mean IKI in seconds
m   = 12 / WPM
```
*(60 s/min ÷ m s/char = 60/m chars/min; ÷ 5 chars/word = 12/m WPM.)*

Sanity check: 80 WPM ⇒ m = 150 ms. 100 WPM ⇒ 120 ms. 120 WPM ⇒ 100 ms. These match observed values for real typists, which is our first validation that the model is calibrated.

### 7.4 Counterfactual cost — "your right pinky costs you ~7 WPM"

This is the headline claim. It is computed, not asserted.

**Algorithm `estimateCost(effect)`:**

1. Take the user's **reference corpus**: the transition-frequency distribution of their Typing Profile's real-world corpus (not of the drills — we want the cost *in their actual life*).
2. Compute predicted geometric-mean IKI over that distribution using the fitted coefficients: `m_actual = Σ_t freq(t) · exp(logIKI_pred(t))`.
3. Construct the counterfactual: replace the coefficient under investigation with the user's own **median across peers of that coefficient** (e.g. for the right pinky, the median of their eight finger coefficients). Do not replace it with zero or with a population value — the claim is "if this finger were as good as *your other fingers*", which is both fairer and more motivating.
4. Recompute `m_counterfactual`.
5. `ΔWPM = 12/m_counterfactual − 12/m_actual`.
6. Attach confidence (§7.7). Report only if confidence ≥ `medium`.

The same procedure produces costs for: individual keys, fingers, hands, same-finger bigrams, row jumps, and specific transitions. This yields a single ranked list of **Findings**, all denominated in the same unit — WPM. That comparability is the product.

**Closed-form sanity check.** For a single multiplicative effect with corpus share `f` and slowness multiplier `k` relative to peers, the counterfactual gain simplifies to:

```
ΔWPM ≈ WPM_current · f · (k − 1)
```

Use this in tests to assert the full pipeline against a known ground truth. Worked example matching the §15.2 habit copy — a 72 WPM typist whose right-pinky keys are `1.96×` slower than their other fingers (180 ms vs 92 ms) and make up `8%` of their corpus transitions:

```
ΔWPM = 72 · 0.08 · 0.96 = 5.5 WPM
```

This is also a useful reality check on the claim itself: a "costing you 7 WPM" headline requires either a large corpus share or a genuinely severe multiplier. If the engine ever produces a double-digit WPM claim for a single finger, that is almost certainly a bug or an unregularized coefficient, and the confidence gate should catch it.

### 7.5 The speed–accuracy tradeoff curve

A separate, equally important model. For each keystroke, compute the **local speed** (rolling WPM over the surrounding `±8` ⚙️ keystrokes) and whether that keystroke was an error. Fit:

```
P(error) = logistic(α + β · localWPM)
```

From this we derive:

- **Control Speed** `V_control`: the WPM at which predicted accuracy crosses `97%` ⚙️. This is the speed the user can actually *hold*.
- **Collapse Speed** `V_collapse`: the WPM at which predicted accuracy crosses `93%` ⚙️. Above this, typing degrades faster than it gains.
- **Speed headroom:** `V_collapse − currentWPM`.

A user whose measured WPM is well above `V_control` is *overdriving* — the single most common cause of plateau, and one no competitor diagnoses.

### 7.6 Rhythm residual analysis

The model's residuals `ε` are themselves informative. Two typists at 80 WPM with identical accuracy can have very different residual dispersion:

- **Low residual dispersion** = smooth, metronomic typing. Predictable, extensible, healthy.
- **High residual dispersion** = burst-and-stall. The user is fast in flashes and hesitating constantly. Their *average* hides the truth.

Define **hesitations** as keystrokes where the residual exceeds `+2.5 MAD` ⚙️ of the residual distribution. Hesitation rate (per 100 keystrokes) and the transitions where hesitations concentrate are first-class outputs.

### 7.7 Confidence gating

Every Finding carries a confidence level. **No Finding is ever shown below `medium`.**

| Level | Requirement |
|---|---|
| `insufficient` | < 30 ⚙️ observations of the pattern, or < 2 sessions |
| `low` | 30–99 observations, or effect within 1 SE of zero |
| `medium` | ≥ 100 observations across ≥ 2 sessions, effect ≥ 2 SE from zero |
| `high` | ≥ 300 observations across ≥ 4 sessions, effect ≥ 3 SE from zero, stable sign across sessions |

Standard errors come from the ridge fit. When confidence is insufficient, the app says so honestly and, if the pattern matters, **schedules a probe** — a short drill designed to gather exactly the missing observations (§12.4). This turns "I don't know" into a plan, which is a far better user experience than a hedge.

### 7.8 Engine outputs (the contract)

At the end of every block, the engine emits:

```ts
interface DiagnosisSnapshot {
  sessionMetrics:  { wpmNet, wpmRaw, accuracy, consistency, hesitationRate, backspaceRate, ... };
  skillProfile:    SkillProfile;              // §8
  findings:        Finding[];                 // ranked by estimated WPM cost, desc
  tradeoff:        { vControl, vCollapse, headroom, r2 };
  bottlenecks:     { patterns: PatternStat[] };
  habits:          HabitFlag[];               // §15
  confidenceNotes: string[];
}
```

This object is the single input to the Planner (§12), the Coach (§14), and the Dashboard (§18.4). Nothing else may read raw keystrokes.

---

## 8. The Skill Profile

### 8.1 Why separate speed from skill

A single WPM number is a bad mental model. It hides the fact that a 82 WPM typist with 61% punctuation control and a 95 WPM typist with 61% punctuation control have the same problem. The Skill Profile makes the shape of someone's ability visible.

Presented to the user as:

```
                  YOU

Speed             82 WPM    ███████░░░   72
Accuracy          97.4%     ████████░░   82
Consistency       91%       █████████░   91
Rhythm            84%       ████████░░   84
Weak-key control  1.37× gap ███████░░░   73
Punctuation       61%       ██████░░░░   61

Overall typing skill   78 / 100
```

*(The scores above are the exact output of the formulas in §8.2 for the stated raw values — they are the reference fixture for the scoring unit tests.)*

### 8.2 The six dimensions

All dimensions are normalized to 0–100. All raw inputs are computed over a trailing window of the last `10` ⚙️ sessions, EWMA-weighted (α = `0.25` ⚙️) so recent performance dominates.

**1. Speed** — from net WPM, via piecewise-linear interpolation on this anchor table ⚙️:

| WPM | 20 | 40 | 60 | 80 | 100 | 120 | 140+ |
|---|---|---|---|---|---|---|---|
| Score | 10 | 30 | 50 | 70 | 85 | 95 | 100 |

**2. Accuracy** — from first-attempt accuracy `acc`:
```
accScore = 100 · clamp((acc − 0.90) / 0.10, 0, 1) ^ 0.65
```
Anchors: 99.5% → 97, 99% → 93, 98% → 87, 97.4% → 82, 97% → 79, 95% → 64, 92% → 35, ≤90% → 0.

The 90% floor is deliberate. Below 90% first-attempt accuracy the user is not typing, they are guessing, and the score should say so.

**3. Consistency** (macro-stability of speed over time) — from the coefficient of variation of per-second WPM within a block:
```
CV = σ(wpm_per_second) / μ(wpm_per_second)
consistencyScore = 100 · clamp(1 − CV, 0, 1)
```
Anchors: CV 0.05 → 95, 0.09 → 91, 0.15 → 85, 0.25 → 75, 0.40 → 60. This is intentionally the same definition Monkeytype uses, so that users who arrive from there see a number they recognize rather than one they have to relearn.

**4. Rhythm** (micro-smoothness, difficulty-adjusted) — from the dispersion of model residuals in log space (§7.6):
```
rhythmScore = 100 · clamp(1 − MAD(ε) / 0.90, 0, 1)          ⚙️ divisor
```
Anchors: MAD 0.10 → 89, 0.14 → 84, 0.20 → 78, 0.35 → 61, 0.60 → 33.

This is the dimension that separates "fast because everything is smooth" from "fast on average because bursts hide stalls". **The `0.90` divisor is the least-grounded constant in this document** — it should be recalibrated against the real distribution of residual dispersion as soon as we have data from ~500 sessions, targeting a median score near 75.

**5. Weak-key control** — the ratio between the user's worst keys and their own median:
```
m_med   = geometric mean IKI across all keys
m_worst = geometric mean IKI of the 5 ⚙️ slowest keys (min 20 observations each)
wkcScore = 100 · clamp(m_med / m_worst, 0, 1)
```
A perfectly even typist scores 100. A typist whose worst keys are twice as slow as their median scores 50.

**6. Punctuation & symbols** — the same formula as Speed, but computed only over the punctuation/symbol/digit character class, scored against the user's own alphabetic speed:
```
punctScore = 100 · clamp(m_alpha / m_punct, 0, 1)
```

### 8.3 The composite score

```
Overall = 0.30·Speed + 0.25·Accuracy + 0.15·Consistency
        + 0.10·Rhythm + 0.12·WeakKeyControl + 0.08·Punctuation
```
⚙️ Weights are a single exported constant. The UI must always be able to explain the score: tapping it opens a breakdown showing each dimension's contribution in points, and the largest single available gain.

### 8.4 Score integrity rules

- The composite score must never decrease due to a change in our formulas without an explicit, communicated recalibration event (versioned: `score_version`).
- A single bad session must not move the composite by more than `3` ⚙️ points (EWMA plus a clamp). Users need the score to feel like a possession, not a mood ring.
- Scores are computed server-side on session ingest and stored, never recomputed on the fly for display.

---

## 9. Spaced repetition for motor patterns

### 9.1 Why motor memory needs its own scheduler

Standard SRS (SM-2, FSRS, Anki) models *declarative* recall: you either remember the fact or you don't, and forgetting is exponential. Motor memory differs in three ways that matter:

1. **It decays much more slowly.** You do not forget how to ride a bicycle in three days.
2. **The signal is graded and continuous**, not binary. We do not need to ask the user how it went — we measure the IKI and accuracy directly.
3. **Massed practice within a session has real value** for motor consolidation, unlike for facts. So we need a *two-tier* schedule: intra-session and inter-session.

### 9.2 Item model

An SRS item is a `(pattern, patternType)` pair:

```ts
interface SrsItem {
  pattern: string;             // "po", "rio", "p", ";", "shift+9"
  patternType: 'key' | 'bigram' | 'trigram' | 'word' | 'class';
  stability: number;           // S, in days
  difficulty: number;          // D, 0..1
  lastReview: timestamp;
  dueAt: timestamp;
  reps: number;
  lapses: number;
  targetIki: number;           // ms — the performance bar for this pattern
  state: 'new' | 'learning' | 'review' | 'mastered' | 'relearning';
}
```

### 9.3 Grading — measured, not self-reported

After each exposure of a pattern within a block, compute a grade from the measured performance:

```
ratio = observedIki / targetIki
```

| Grade | Condition |
|---|---|
| `again` | any error on the pattern, OR `ratio > 1.6` ⚙️ |
| `hard`  | `1.25 < ratio ≤ 1.6` |
| `good`  | `1.00 < ratio ≤ 1.25` |
| `easy`  | `ratio ≤ 1.00` and no error |

`targetIki` is derived from the user's own current global geometric-mean IKI × a difficulty factor for that pattern class (SFBs and row-jumps get a permanently higher allowance ⚙️). The bar therefore rises automatically as the user gets faster — mastery is always relative to their current ability.

A grade requires a minimum of `4` ⚙️ observations of the pattern within the block; single-observation noise never triggers a state change.

### 9.4 Scheduling

**Retrievability** (motor variant — power law, much flatter than declarative):
```
r(Δ, S) = (1 + Δ / (9 · S)) ^ −0.4          ⚙️ (k=9, decay=−0.4)
```

**Stability update** on review:
```
again:  S ← clamp(S · 0.20, 0.02, 3.0)     // floor 0.02 d ≈ 30 min; ceiling 3 d
hard:   S ← S · (1.15 + 0.10·(1−r))
good:   S ← S · (2.10 + 0.60·(1−r))
easy:   S ← S · (3.00 + 1.00·(1−r))
S ← min(S, 365)                            ⚙️ stability ceiling
```
The `(1−r)` term implements the spacing effect: successfully recalling something you had almost forgotten increases stability more than reviewing something fresh.

The **ceiling on `again`** matters and is easy to get wrong: a pattern with `S = 40 d` that the user just failed must not be rescheduled 8 days out simply because 40 × 0.2 = 8. A failure means the pattern is not actually stable, whatever the history says, so we cap the post-lapse interval hard.

**Difficulty update:** `D ← clamp(D + 0.12·(gradeIndex_target − gradeIndex), 0, 1)` where `gradeIndex_target = good`. Difficulty scales the interval down: `effectiveS = S · (1 − 0.5·D)`.

**Due time:** we schedule the review at the point where predicted retrievability falls to the target `R_target = 0.85` ⚙️. Inverting the retrievability function:

```
r = (1 + Δ/(9S))^−0.4  =  R_target
⇒  Δ = 9S · (R_target^(−1/0.4) − 1)
⇒  dueAt = lastReview + effectiveS · RETENTION_FACTOR
   where RETENTION_FACTOR = 9 · (0.85^−2.5 − 1) ≈ 4.51      ⚙️ derived, not guessed
```

Interval cap: `min(interval, 180 d)` ⚙️.

**Worked trajectory** (new item, `S₀ = 0.5 d`, `D = 0`, all `good`, reviewed on time) — this is the reference fixture for the scheduler tests:

| Rep | S after (d) | Next interval (d) |
|---|---|---|
| 1 | 1.10 | 4.9 |
| 2 | 2.40 | 10.8 |
| 3 | 5.25 | 23.7 |
| 4 | 11.5 | 51.8 |
| 5 | 25.2 | 113 |
| 6 | 55.2 | 180 (capped) |

Six clean reviews to effectively permanent retention is the right shape for a motor pattern. Compare with declarative SRS, which would need roughly the same number of reps but decays far faster between them — hence the flatter power law (§9.4) rather than an exponential.

### 9.5 The intra-session ladder

Independently of the day-scale schedule, a pattern graded `again` inside a session enters an immediate ladder:

```
again  →  re-expose at +2 min  →  +6 min  →  +15 min  →  next session
```
Each rung requires a `good` or better to advance; a failure resets to the bottom rung. Blocks are generated to satisfy the ladder without the user perceiving repetition — the *pattern* repeats, the *words* do not.

### 9.6 Queue construction

At session planning time, build the pattern queue as:

- `50%` ⚙️ **due review items**, ordered by (estimated WPM cost × overdueness)
- `30%` ⚙️ **new items** from the current curriculum position, capped at `4` ⚙️ new patterns per session (motor learning saturates fast; do not flood)
- `20%` ⚙️ **interleaved mastered items** for retention and confidence

Interleaving (mixing patterns) rather than blocking (drilling one pattern to exhaustion) is deliberate: it produces slower in-session performance and better long-term retention. The UI should reflect this honestly — "today will feel harder; that's how it works."

---

## 10. The Content Engine

### 10.1 The ladder

The transition from drills to real text is the single most under-solved UX problem in typing training. Going from `fjf jdk kdk` straight to *"The quick brown fox…"* wastes the drill. We define six stages, and the user is promoted between them only on evidence.

| # | Stage | Example (targeting `io`) | Purpose |
|---|---|---|---|
| 0 | **Drill** | `io io oi io iol iop io` | Isolate the motor pattern |
| 1 | **Synthetic** | `riom piol niot iole` | Pattern in word-shaped context, no lexical help |
| 2 | **Words** | `vision action period previous` | Pattern in real lexical context |
| 3 | **Phrases** | `previous version` · `national action` | Pattern across word boundaries |
| 4 | **Sentences** | `The previous version had a serious problem.` | Full punctuation, capitalization, rhythm |
| 5 | **Prose / Real-world** | Profile-specific real text (§10.4) | Transfer to actual usage |

### 10.2 Promotion and demotion criteria

Promote from stage *n* to *n+1* when, for the target pattern:

- accuracy ≥ `98%` ⚙️ over the last `30` ⚙️ observations, **and**
- geometric-mean IKI ≤ `1.20 ×` ⚙️ the user's global geometric-mean IKI, **and**
- observed in ≥ `2` ⚙️ separate sessions, **and**
- residual dispersion for the pattern not in the worst decile

Demote one stage if accuracy on the pattern falls below `93%` ⚙️ over `20` observations at the current stage. Demotion must be framed neutrally in the UI ("we're reinforcing this one"), never as failure.

**This gate is the difference between practice and training.** It is the single most important rule in the content engine.

### 10.3 Generators

Each stage has a generator with a common interface:

```ts
interface Generator {
  stage: Stage;
  generate(req: {
    targets: Pattern[];        // patterns to emphasize
    allowedChars: Set<string>; // unlocked characters only (Foundations)
    targetDensity: number;     // desired occurrences of targets per 100 chars
    length: number;            // characters
    profile: TypingProfile;
    difficulty: number;        // 0..1, controls rare-pattern injection
    seed: number;              // deterministic for testing
  }): GeneratedText;
}
```

**Generator requirements:**

- **Target density** must land within ±`20%` ⚙️ of the request. Too low and the drill is diluted; too high and it becomes an unnatural tongue-twister that trains a pattern the user will never encounter. Default density: `18` ⚙️ occurrences per 100 characters, decreasing toward natural frequency as stage increases (stage 5 = natural frequency, no injection at all).
- **No immediate repetition** of the same word within `6` ⚙️ words.
- **Deterministic given a seed** — required for tests and for reproducing a user's exact session.
- **Synthetic word generator** must produce pronounceable, phonotactically plausible strings (weighted character n-gram model trained on the profile lexicon), not random letters. Pronounceability materially affects typing chunking.
- **Word generator** filters a frequency-ranked lexicon by `allowedChars` and target containment, sampling by Zipf-weighted frequency so that common words dominate — you get more transfer from practising `the` than `thermodynamic`.

### 10.4 Real-world corpora (stage 5)

Content is bucketed by domain and mixed according to the user's Typing Profile:

| Domain | Example content |
|---|---|
| `general` | `I'll send the document over tomorrow morning.` |
| `work_email` | `Hi Sarah, Just following up on our conversation...` · `Could you review the latest version before Friday?` |
| `prose` | Public-domain literary and journalistic passages |
| `code_js` | `const user = await fetchUser(userId);` |
| `code_py` / `code_ts` / `code_sql` | Profile-selected language mix |
| `terminal` | `git checkout -b feature/authentication` |
| `numbers` | `$1,249.99` · `2026-08-26` · `10.24.18.53` |
| `data_entry` | `INV-2026-08471` · `SGD 1,284.50` · `+65 6123 4567` |
| `punctuation_heavy` | `"Wait — you're telling me it actually works?"` |
| `chat` | Short informal messages, contractions, no capitalization |

**Profile → domain mix (defaults ⚙️):**

| Profile | Mix |
|---|---|
| Developer | code 45%, terminal 15%, general 20%, punctuation 10%, numbers 10% |
| Writer | prose 50%, general 25%, punctuation 20%, numbers 5% |
| Student | prose 35%, general 30%, punctuation 20%, numbers 15% |
| Office worker | work_email 45%, general 25%, numbers 20%, punctuation 10% |
| Data entry | data_entry 50%, numbers 35%, general 15% |
| Gamer | chat 45%, general 35%, punctuation 20% |
| Competitive typist | prose 40%, general 40%, punctuation 20% |

**Corpus requirements:** every stage-5 passage must be checked for length (40–400 chars), reading level, absence of offensive content, and licence compatibility (§22.3). Passages are stored with a `charProfile` (which characters and transitions they contain) so the selector can pick a passage that naturally emphasises the session's targets — **selection, not injection**, at stage 5.

### 10.5 Code-typing specifics

Code is not prose and must be handled explicitly:

- Auto-indent is **disabled**; the user types leading whitespace (this is a real skill).
- Bracket/quote auto-pairing is **disabled**.
- Symbol-heavy transitions (`=>`, `!==`, `::`, `</`, `){`) are first-class trainable patterns with their own SRS items.
- Tab is a typed character, not a focus change (with an accessibility escape hatch: `Esc` then `Tab` to leave the field — required, see §21.5).

---

## 11. The Curriculum

### 11.1 Structure

Five tracks, each containing units. The curriculum is the **default ordering**; the Diagnosis Engine can reorder, skip, or insert units at any time. It is a map, not a rail.

```
FOUNDATIONS
  ✓ Home row
  ✓ Top row / bottom row
  ✓ Touch-typing posture (no-look introduction)
  ✓ Basic accuracy (98% at any speed)

CONTROL
  ✓ Weak-key remediation
  ✓ Finger independence
  → Hand alternation
  → Same-finger bigrams
  → Row jumps

SPEED
  → Common bigrams
  → Word chunking
  → Word-boundary transitions
  → Rhythm
  → Burst speed

FLUENCY
  → Sentences
  → Punctuation
  → Capitalization & shift control
  → Numbers & symbols
  → Real-world text (profile-specific)

MASTERY
  → 80 WPM sustained
  → 100 WPM sustained
  → 120 WPM sustained
  → 140 WPM sustained
```

### 11.2 Progressive character unlocking (Foundations only)

Like Keybr, but with an explicit, visible rule. A new character unlocks when all currently-unlocked characters meet the mastery bar:

- accuracy ≥ `97%` ⚙️, and
- geometric-mean IKI ≤ `1.35 ×` ⚙️ the home-row baseline, and
- ≥ `40` ⚙️ observations each

Unlock order is not alphabetical and not purely frequency-based: it maximizes **the number of real words typeable** per character added, starting from the home row. (Precomputed order shipped as a data file; recomputable per layout.)

Once the user leaves Foundations, all characters are unlocked permanently. Users entering at 50+ WPM skip Foundations entirely based on the calibration test (§18.2).

### 11.3 Dynamic curriculum

Every session, the Planner may:

- **Insert** a unit (a diagnosis found a weakness the curriculum hasn't reached yet — e.g. a punctuation problem in a Control-stage user).
- **Skip** a unit (calibration shows it's already mastered).
- **Reopen** a completed unit (regression detected).
- **Reorder** within a track by estimated WPM payoff.

The user always sees *why*: "We've pulled Punctuation forward — it's costing you more than hand alternation right now."

---

## 12. Autopilot: the session planner

**This is the centerpiece feature.** One button. The system decides everything.

### 12.1 The loop

```
ANALYSIS (load state + last DiagnosisSnapshot)
   ↓
FIND WEAKNESSES (rank Findings by WPM cost × confidence)
   ↓
BUILD SRS QUEUE (§9.6)
   ↓
COMPOSE BLOCKS (§12.2)
   ↓
GENERATE CONTENT (§10.3, buffered ahead)
   ↓
MEASURE RESPONSE (live, §13)
   ↓
UPDATE MODEL (ridge refit + SRS grades)
   ↓
RE-COMPOSE REMAINING BLOCKS (mid-session, §13.3)
   ↓
RETEST (closing speed test block)
   ↓
UPDATE LONG-TERM PLAN + write session report
```

### 12.2 Block composition template

A default 15-minute Autopilot session ⚙️:

| # | Block | Duration | Objective | Content |
|---|---|---|---|---|
| 1 | **Warm-up** | 2 min | Reach working speed; collect baseline for today | Mastered patterns, stage 3–4, no pressure, no scoring |
| 2 | **Primary target** | 4 min | Highest-WPM-cost Finding | Stage per §10.2, targeted density, `again`-graded items first |
| 3 | **Secondary target** | 3 min | Second Finding, or intra-session ladder rung for block 2's failures | Interleaved |
| 4 | **Transfer** | 5 min | Move today's gains into real text | Stage 4–5, profile corpus selected to contain today's targets |
| 5 | **Speed test** | 1 min | Consistent measurement point | Fixed-methodology test, stage 5, standard corpus, **never** targeted |

Total 15 min. Autopilot also supports **5 min** (blocks 1, 2, 5), **10 min** (1, 2, 4, 5) and **25 min** (adds a second primary + an endurance block) ⚙️.

**Invariants:**
- The speed test block must always use the same methodology and an untargeted corpus, otherwise the user's WPM trend line is corrupted by the training itself. This is a hard requirement.
- Warm-up is never scored against the user's profile.
- No block may target a pattern with confidence below `medium` unless it is explicitly a **probe** (§12.4).

### 12.3 Fatigue and load management

- Track cumulative keystrokes in the session and in the trailing 24h.
- If within-session speed declines > `8%` ⚙️ from the session's own peak across two consecutive blocks, insert a `30 s` micro-rest with a breathing/stretch prompt and reduce difficulty for the next block.
- Cap: warn at `45 min` ⚙️ of typing in a day; the app should not encourage RSI. This is a wellbeing requirement, not a nice-to-have.
- Suggest a rest day after `6` ⚙️ consecutive training days.

### 12.4 Probes

When a potentially important pattern has `insufficient` confidence, the Planner may schedule a **probe**: a 45–90 s block engineered to collect the exact missing observations (e.g. `p` preceded by `o` and by `l`, 40 occurrences each, at varied speeds). Probes are invisible to the user as a category — they simply appear as a short block. Their results feed the model but do not affect scores.

### 12.5 Manual override

Autopilot is the default, not a cage. The user can always choose a Training Mode (§16.1) directly. Overriding does not disable the model — manual sessions still feed diagnosis and SRS.

---

## 13. Real-time adaptation

Keybr adapts *between* lessons. We adapt *within* the session.

### 13.1 The live loop

Every `8` ⚙️ correct keystrokes (roughly once per second at 90 WPM), the live analyzer:

1. Updates rolling EWMA statistics for the patterns just observed.
2. Recomputes the block's live target ranking.
3. If the ranking has changed materially (top target's estimated cost drops below the runner-up by > `10%` ⚙️), signals the generator.

All of this runs in a Web Worker. It must never touch the main thread's input path.

### 13.2 Generation buffering

The content generator maintains a **lookahead buffer** of at least `3` ⚙️ lines / `200` characters ahead of the caret. When a re-target signal arrives, only the *unbuffered* portion changes. Text that the user can already see must never mutate — that is deeply disorienting and destroys trust.

Practical effect: adaptation is visible within 2–4 seconds, never instantly, and never retroactively.

### 13.3 Mid-session re-planning

At each block boundary, the Planner re-evaluates the remaining blocks:

- Target met early → promote a stage, or swap in the next Finding.
- Target not improving after a full block → do not grind. Switch approach: drop a stage, slow the target speed, or move to an adjacent pattern. **Two consecutive failed blocks on the same pattern must trigger a change of strategy, not a third block.**
- New bottleneck emerged → surface it as the next block's target.

### 13.4 In-session coach messages

Short, unobtrusive, between blocks only — never during typing.

```
Block 2 complete.
r → t is 22 ms faster than when we started. 
Your new bottleneck: t → h.
Next block targets it.
```

Rules: maximum one message per block boundary; ≤ 3 lines; always contains one measured number; never contains praise without evidence.

---

## 14. Coach Mode and "Why am I stuck?"

### 14.1 Coach Mode is the personality layer

Coach Mode is on by default and can be turned down to "minimal" (numbers only) ⚙️. It appears in three places:

**Session open (continuity):**
```
Welcome back.
Yesterday we identified your i → o transition as a bottleneck.
Let's fix it. 15 minutes.
```

**Session close (diagnosis):**
```
TODAY'S DIAGNOSIS

You improved 3.8 WPM. Nice work on r and t.
Your accuracy on right-hand transitions dropped 1.9pp — 
that's where tomorrow's session will start.

Next milestone: 80 WPM
Estimated: 6–9 sessions at your current rate.
```

**Milestone / habit alerts:** surfaced at most once per session.

### 14.2 Voice and rules

The coach is: **specific, quantified, unsentimental, and on your side.** A good strength coach, not a cheerleader.

Hard rules:
1. Every claim carries a number.
2. Never praise without evidence. "Nice work" must attach to a measured improvement.
3. Never more than one criticism per report, and it is always followed by the prescription.
4. Never use exclamation marks, emoji-as-reaction, or the words "amazing", "awesome", "incredible".
5. Estimates ("6–9 sessions") must be derived from the user's own measured rate of change, with a range, never a point estimate.
6. If the data is thin, the coach says so: "One session isn't enough to call this a trend — let's get two more."

### 14.3 "Why am I stuck?" — the flagship diagnostic

Available any time from the dashboard; automatically offered when plateau is detected.

**Plateau detection:** over the last `N = 10` ⚙️ sessions spanning ≥ `14` ⚙️ days, fit OLS of session speed-test WPM on session index. Plateau if the 10-session projected gain < `1.5` ⚙️ WPM and the slope's 95% CI includes zero.

**The analysis pipeline** (each step produces a Finding with an estimated ΔWPM, sorted descending):

| # | Candidate cause | Detection | Typical prescription |
|---|---|---|---|
| 1 | **Accuracy instability under speed** | Measured WPM > `V_control` (§7.5); accuracy falls > `3pp` ⚙️ between lowest and highest speed quartile | Precision blocks at `V_control − 5` WPM; rebuild the ceiling from below |
| 2 | **Weak finger / hand imbalance** | Ridge finger coefficient ≥ `2 SE` above peer median; counterfactual §7.4 | Targeted finger-independence drills + hidden-keyboard blocks |
| 3 | **Specific transition bottlenecks** | Top `δ_bigram` residuals by frequency-weighted cost | SRS-scheduled transition drills, ladder to words |
| 4 | **Rhythm collapse above a threshold** | Residual MAD rises sharply above a given local WPM | Metronome / pacing mode at threshold − 5 WPM |
| 5 | **Backspace overhead** | Time spent in corrections as % of session time > `6%` ⚙️ | Strict-mode precision blocks; error-anticipation drills |
| 6 | **Character-class gap** | Punctuation/number score ≥ `15` ⚙️ points below alphabetic | Fluency-track punctuation unit pulled forward |
| 7 | **Visual dependence** | Hidden-mode performance ≥ `12%` ⚙️ worse than visible-mode | Progressive fading protocol (§16.2) |
| 8 | **Insufficient / irregular practice** | < `3` sessions/week or high inter-session gap variance | Schedule and volume recommendation |

**Output format:**

```
WHY YOU'RE STUCK AT 72 WPM

Your plateau is caused by accuracy instability, not by raw speed.

  Your raw speed is actually 81 WPM.
  At 70+ WPM your accuracy drops from 98.2% → 93.7%.
  64% of your errors come from four patterns:
      r → t      i → o      n → g      right-pinky keys

  Estimated cost:  −6.4 WPM   (high confidence)

WHAT TO DO

  8 min transition drills + 5 min precision mode,
  for your next 5 sessions.

  Expected: 76–79 WPM in ~2 weeks.

  [ Start this plan ]
```

The `[ Start this plan ]` button writes the prescription into the Planner as a multi-session plan. **A diagnosis that cannot be acted on with one click is a failure of this feature.**

---

## 15. Bad-habit detection

Habits are hypotheses with evidence, surfaced at most one per session, and always with a specific remedy.

### 15.1 Detectors

| Habit | Signal | Threshold ⚙️ |
|---|---|---|
| **Visual search for a key** | Key's mean latency far exceeds its model prediction, AND the excess shrinks when the on-screen keyboard is visible | latency ≥ `1.8 ×` neighbouring keys, and visible-vs-hidden gap ≥ `25%` |
| **Hand imbalance** | Mean per-hand IKI difference | ≥ `10%` sustained over 3 sessions |
| **Rhythm collapse threshold** | Residual MAD by local-WPM bucket shows a knee | knee detected with ≥ `200` samples per bucket |
| **Backspace thrash** | Corrections per 100 chars, and correction-of-correction events | ≥ `8` per 100 chars |
| **Word-boundary hesitation** | Hesitation rate at space-adjacent transitions vs within-word | ≥ `1.5 ×` |
| **Burst-and-stall** | High consistency score paired with low rhythm score | consistency − rhythm ≥ `20` points |
| **Shift-hand error** | Capitalization consistently done with the same-side shift key (inferred from timing spike on same-hand shift+letter) | latency ≥ `1.6 ×` opposite-hand shift equivalent |
| **Look-ahead failure** | Hesitation spikes at line/passage boundaries | ≥ `2 ×` mid-line rate |
| **Overdriving** | Sustained typing above `V_collapse` | > `20%` of keystrokes |

### 15.2 Presentation

```
⚠️  POSSIBLE HABIT DETECTED

You pause before p.
Your average reaction time on p is 180 ms,
compared with 92 ms for its neighbours.

This pattern is consistent with visually searching for the key.

  → Try this 90-second drill with the keyboard hidden.
     [ Start ]     [ Not for me ]
```

### 15.3 Suppression

- One habit alert per session maximum.
- `Not for me` suppresses that detector for `30` ⚙️ days.
- A habit that resolves gets a closing acknowledgement: *"Your p hesitation is gone — 94 ms, in line with its neighbours."* Closing the loop is what makes the feature feel like a coach rather than a nag.

### 15.4 Honesty constraint

We cannot see hands. All habit copy uses hedged, evidence-first phrasing: *"This pattern is consistent with…"*, never *"You are looking at the keyboard."* Overclaiming here would destroy the credibility that the entire product depends on.

---

## 16. Training modes and visibility modes

### 16.1 Training modes

| Mode | Purpose | Mechanics |
|---|---|---|
| 🤖 **Autopilot** *(default)* | Everything decided for you | §12 |
| 🎯 **Fix Weaknesses** | Pure adaptive targeting | Continuous drill on the top 3 Findings, stage-appropriate |
| ⚡ **Speed** | Push maximum WPM | Shorter, easier text; accuracy floor of `95%` ⚙️ enforced as a soft gate |
| 🎯 **Precision** | Accuracy target | Strict mode; target `99.5%` ⚙️; speed deliberately capped by a pacer |
| 🧠 **Muscle Memory** | Build no-look automaticity | Keyboard hidden, targeted patterns, slower pace |
| 🧱 **Endurance** | Sustained performance | 5–15 min continuous prose; measures speed decay curve |
| 🔥 **Pressure** | Both at once | Speed floor + accuracy floor; failure ends the run |
| 💻 **Real World** | Transfer | Stage-5 profile corpus only |
| 🧪 **Experiment** | Curiosity | Unusual distributions, rare bigrams, alternative layouts, custom text |
| 🥊 **Duel** **[V2]** | Race a person | Async ghost-race first (race your own past run or a friend's replay), live P2P later |

### 16.2 Visibility modes

A first-class training variable, not a cosmetic setting:

| Mode | Description |
|---|---|
| `keyboard_visible` | On-screen keyboard with next-key highlight |
| `keyboard_faded` | Keyboard shown at 25% opacity, highlight only on hesitation |
| `keyboard_hidden` | No keyboard |
| `text_faded` | Upcoming text dimmed to force look-ahead |
| `blind` | No live correctness feedback at all; results revealed at the end |

**Touch-typing confidence** is a derived metric:

```
ttc = 100 · clamp( (wpm_hidden / wpm_visible) · (acc_hidden / acc_visible), 0, 1 )
```
Requires ≥ `3` ⚙️ paired blocks in each mode within a trailing 14 days; otherwise displayed as "not yet measured" rather than estimated.

**Fading protocol:** for users with detected visual dependence, the Planner steps them through `visible → faded → hidden` one step per `3` ⚙️ consecutive successful sessions, with automatic step-back on regression.

---

## 17. Progression, milestones, achievements

### 17.1 Tone

Adult. Understated. Achievements celebrate *volume and precision*, which are real, rather than trivia.

Good: `100,000 error-free characters`
Bad: `🎉 YOU TYPED 10 WORDS!!!`

### 17.2 The journey bar

```
Your typing journey

60 WPM ─────●──────────── 100 WPM
            ↑
          YOU: 78
```
Endpoints are the user's own starting speed and their chosen goal, not arbitrary global bounds.

### 17.3 Milestones

Speed milestones (`80 / 100 / 120 / 140 WPM sustained over a 1-minute test at ≥97% accuracy`) plus skill milestones (`Overall 60 / 75 / 90`), plus track completions.

Each milestone shows an **estimate**: "Next milestone: 80 WPM · estimated 6–9 sessions" — computed from the user's own trailing rate of change with a confidence band. Never a false promise.

### 17.4 Unlocks

Progression unlocks *content and challenges*, not cosmetics:

- New text domains (code, legal, medical, academic)
- Difficult punctuation sets
- Code challenges by language
- Long-form and Marathon mode (30 min continuous)
- Precision mode at 99.9%
- Rare-bigram gauntlets

### 17.5 Streaks — carefully

Streaks are motivating and also a well-known source of guilt-driven overuse and RSI. Rules:

- Streak counts **weeks with ≥3 sessions**, not consecutive days. This is deliberate: it rewards consistency without punishing rest.
- Rest days are shown as healthy, not as failures.
- One "freeze" per month, automatic and silent.

---

## 18. UX and information architecture

### 18.1 Principles

1. **The home screen makes the decision for you.** Open the app, see today's workout, press start.
2. **The typing surface is sacred.** During typing: no chrome, no ads, no notifications, no layout shift, no animation that isn't feedback.
3. **Every number is explainable.** Any metric can be tapped to reveal how it was computed and what would improve it.
4. **Dark by default**, light available, respects `prefers-color-scheme`. High-contrast mode required.
5. **Keyboard-first.** The entire app is navigable without a mouse — the audience will notice if it isn't.

### 18.2 Onboarding (target: under 3 minutes to first value)

```
1. Landing → [ Start typing ]           (no account required)
2. Layout detection (auto, 5 s)
3. Calibration test (90 s):
     30 s general prose
     30 s targeted coverage of all letters + common bigrams
     30 s punctuation, capitals, digits
4. FIRST DIAGNOSIS  ← the aha moment
     "You type at 68 WPM. Your accuracy is 96.1%.
      Your slowest transitions are i→o, r→t, and the right pinky.
      Your right pinky alone is costing you about 5 WPM.
      Here's a 15-minute session that targets it."
5. [ Start session ]
6. Account creation offered AFTER the first completed session
   ("Save your progress"), never before.
```

The calibration test is engineered for **coverage**, not for a pleasant reading experience: it must touch every letter ≥ 8 times and the top 60 bigrams ≥ 4 times ⚙️ within 90 seconds. Results seed the model with `low` confidence, shrunk hard toward the population prior.

**Anonymous-first is a requirement.** Progress is stored locally and migrated into the account on signup.

### 18.3 Home screen

```
GOOD EVENING, ALEX

You're 4 WPM away from your 30-day goal.

        78 → 82 WPM

Today's workout
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Warm-up                 2 min
2. Fix right pinky         4 min
3. r → t transitions       3 min
4. Real-world typing       5 min
5. Speed test              1 min

TOTAL                     15 min

            [ START ]

              ·  ·  ·
     Choose a different mode  →
```

Everything else — dashboard, history, settings — is one click away and out of the primary path.

### 18.4 Typing Health dashboard

```
TYPING PERFORMANCE
────────────────────────────
Current speed        83 WPM
30-day average       78 WPM
Best                 96 WPM

Accuracy            97.8%
Consistency           91%
Characters typed   482,391
────────────────────────────

TOP BOTTLENECKS
1. Right pinky       ████████░░   −6.1 WPM
2. io transition     ███████░░░   −2.4 WPM
3. punctuation       ██████░░░░   −1.9 WPM
────────────────────────────

THIS WEEK
Speed              +4.2%
Accuracy           +0.8%
Consistency        +6.1%
────────────────────────────

NEXT RECOMMENDATION
12 minutes/day · 5 days
Expected: +3–5 WPM

           [ Why am I stuck? ]
```

Additional dashboard views (secondary tabs): keyboard heatmap (per-key speed and accuracy, colour-coded), transition matrix, speed-accuracy curve with `V_control` marked, hand balance over time, SRS forecast, session history.

### 18.5 The typing surface

- Monospace by default; proportional optional. Font size adjustable, `18px` default ⚙️.
- Three lines visible: previous (dimmed), current, next. Smooth scroll on line completion, never mid-line reflow.
- Caret: block caret, 2px, no blink during active typing (blinking caret measurably distracts).
- Correct characters: foreground colour. Incorrect: red background with the *typed* character shown, not the expected one. Untyped: muted.
- Live HUD (WPM, accuracy, time) is **off by default in Autopilot** — watching your WPM tick changes how you type. Available as a setting, and always shown in Speed mode.
- Word-level error highlight on completion for stage ≥ 3.

### 18.6 Session report

One screen, in this order: what changed today (the headline number), the diagnosis, what tomorrow will target, the skill profile delta, and a thumbs up/down on the diagnosis quality (feeds §4.3).

### 18.7 Accessibility

- Full keyboard navigation; visible focus rings.
- `prefers-reduced-motion` honoured; all animation optional.
- Screen-reader support for dashboard and reports (the typing surface itself is inherently visual; provide a text summary alternative).
- Colour is never the only signal — errors carry an underline as well as colour.
- Escape hatch from the typing field for keyboard-only users (`Esc` then `Tab`).

---

## 19. Technical architecture

### 19.1 Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **Next.js 15+ (App Router), TypeScript strict** | Vercel-native, RSC for dashboard, route handlers for API |
| Styling | **Tailwind CSS v4** + CSS variables for theming | Speed of iteration; theme tokens for dark/light/high-contrast |
| UI primitives | **shadcn/ui** (Radix) | Accessible by default, unstyled enough to control |
| Client state | **Zustand** for session state; **TanStack Query** for server state | Session state must be outside React's render cycle |
| Local persistence | **Dexie (IndexedDB)** | Offline-first write-ahead log |
| Backend | **Supabase** — Postgres + Auth + RLS | Free tier, Vercel-friendly, RLS gives per-user isolation cheaply |
| Analysis | **Web Worker** (Comlink) | Never block the input path |
| LLM narration | **Anthropic API**, server route only | §19.6 |
| Charts | **visx** or lightweight custom SVG | Avoid heavy chart libs on the dashboard |
| Testing | **Vitest** (engine), **Playwright** (e2e) | Engine tests are the priority |
| Analytics | **PostHog** (self-serve, EU/US region per §22) | Product metrics from §4.3 |
| Deploy | **Vercel** (preview per PR, prod on `main`) | — |

### 19.2 Repository layout

```
typing-trainer/
├─ apps/web/                     # Next.js app
│  ├─ app/
│  │  ├─ (marketing)/            # landing
│  │  ├─ (app)/
│  │  │  ├─ page.tsx             # home / today's workout
│  │  │  ├─ session/             # the typing surface
│  │  │  ├─ dashboard/
│  │  │  ├─ history/
│  │  │  └─ settings/
│  │  └─ api/
│  │     ├─ session/route.ts     # ingest
│  │     ├─ coach/route.ts       # LLM narration
│  │     └─ cron/aggregate/route.ts
│  ├─ components/
│  └─ workers/analysis.worker.ts
├─ packages/engine/              # ★ pure TypeScript, zero React, zero I/O
│  ├─ src/
│  │  ├─ config.ts               # ⚙️ every tunable constant, one file
│  │  ├─ capture/                # keystroke normalization, layout maps
│  │  ├─ metrics/                # wpm, accuracy, consistency, rhythm
│  │  ├─ model/                  # ridge attribution, tradeoff curve
│  │  ├─ diagnosis/              # findings, counterfactuals, confidence
│  │  ├─ srs/                    # scheduler
│  │  ├─ planner/                # autopilot
│  │  ├─ generators/             # content ladder stages 0–5
│  │  └─ simulator/              # synthetic typist (Appendix C)
│  └─ test/
├─ packages/content/             # corpora, lexicons, layouts, unlock orders
├─ supabase/migrations/
└─ docs/PRD.md
```

**The `packages/engine` boundary is a hard architectural rule.** It contains no React, no browser APIs, no network calls, and no randomness that isn't seeded. Everything in it is a pure function of its inputs. This is what makes the product testable, and it is what makes an AI agent able to work on it safely.

### 19.3 The input path (performance-critical)

The single most important piece of code in the app. Requirements:

```
keydown fires
  → read timestamp (sync)
  → push to preallocated ring buffer (no allocation)
  → compute correctness (O(1) lookup)
  → mark dirty, request animation frame
  → RETURN   (target: < 1 ms)

rAF fires
  → render only changed character spans (direct DOM mutation via refs,
     NOT a React re-render of the whole passage)
  → target: < 4 ms
```

**Prohibited in the keydown handler:** React `setState` on the passage, `await`, JSON serialization, array `push` that can reallocate, layout reads (`offsetWidth`, `getBoundingClientRect`), console logging in production.

**Budget:** keystroke → visible feedback ≤ `16 ms` (one frame at 60 Hz) at p99. This must be measured in CI with a synthetic input harness, not assumed.

### 19.4 Analysis pipeline

```
Main thread                Web Worker                Server
───────────                ──────────                ──────
ring buffer
  │ every 8 keystrokes
  └─ postMessage(batch) ──→ EWMA update
                            live target ranking
       live coach msg ←──── (structured, no strings)
  │ block end
  └─ postMessage(block) ──→ ridge refit
                            SRS grading
                            DiagnosisSnapshot
       snapshot       ←────
  │ session end
  └─ POST /api/session ───────────────────────────→  validate, persist,
                                                      recompute scores,
                                                      write diagnosis,
                                                      generate coach text
```

Workers must degrade gracefully: if `Worker` is unavailable, analysis runs on the main thread **between blocks only**, never during typing.

### 19.5 Offline-first sync

1. Every block writes to IndexedDB immediately (write-ahead log).
2. Sync attempts on block end; failures queue.
3. On reconnect, flush queue in order. Sessions carry a client-generated UUID; the server upsert is idempotent.
4. Conflict policy: server is authoritative for *scores*, client is authoritative for *raw session data*. Scores are always recomputed server-side from raw data.
5. A user must be able to complete a full session with no network.

### 19.6 LLM narration layer

**Principle: the model decides nothing. It only speaks.**

- All analysis, ranking, planning, and numbers are produced by `packages/engine` and are fully deterministic.
- `POST /api/coach` receives a `DiagnosisSnapshot` (structured JSON, already computed) and returns 2–5 sentences of coach prose.
- The prompt includes the voice rules from §14.2 and a hard instruction that **no number may appear in the output that is not present in the input JSON**.
- Output is validated: every numeral in the response must match a value in the input (within formatting tolerance). Validation failure → fall back to templates.
- **Templates are a first-class path, not a fallback afterthought.** Every coach message has a deterministic template version. The app is fully functional with the LLM disabled — this keeps the free tier viable and CI hermetic.
- Cache by `(diagnosis hash, message type)`. Rate limit: `20` ⚙️ generations/user/day.
- Model: Claude Haiku-class for cost, escalating to Sonnet-class only for the "Why am I stuck?" long-form narration ⚙️.
- Cost guardrail: target < `$0.01` per active user per month.

### 19.7 Determinism and reproducibility

Every session stores: `engine_version`, `score_version`, `generator_seed`, `layout_id`, `config_hash`. Any session can be replayed exactly. This is essential for debugging user-reported "the app said something wrong" and for validating that an engine change did not silently shift everyone's scores.

---

## 20. Data model

### 20.1 Postgres schema (Supabase)

```sql
-- Profiles ------------------------------------------------------------
create table profiles (
  id            uuid primary key references auth.users on delete cascade,
  display_name  text,
  layout_id     text not null default 'qwerty-us',
  typing_profile jsonb not null default '{"developer":1.0}'::jsonb,
  goal_wpm      int,
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- Sessions ------------------------------------------------------------
create table sessions (
  id             uuid primary key,                    -- client-generated
  user_id        uuid not null references profiles(id) on delete cascade,
  started_at     timestamptz not null,
  ended_at       timestamptz,
  mode           text not null,                       -- 'autopilot' | 'speed' | ...
  planned_minutes int,
  engine_version text not null,
  score_version  int not null,
  config_hash    text not null,
  layout_id      text not null,
  -- denormalized session metrics
  wpm_net        real, wpm_raw real, accuracy real,
  consistency    real, rhythm real,
  keystrokes     int, errors int, corrections int,
  active_ms      int,
  created_at     timestamptz not null default now()
);
create index on sessions (user_id, started_at desc);

-- Blocks --------------------------------------------------------------
create table session_blocks (
  id           uuid primary key,
  session_id   uuid not null references sessions(id) on delete cascade,
  ordinal      int not null,
  kind         text not null,        -- 'warmup'|'target'|'transfer'|'test'|'probe'
  stage        int not null,         -- 0..5
  targets      text[] not null,
  visibility   text not null,
  generator_seed bigint not null,
  text_hash    text not null,
  wpm_net real, accuracy real, rhythm real,
  keystrokes int, active_ms int,
  -- compressed keystroke stream: columnar arrays, zstd/gzip, base64 or bytea
  keystrokes_blob bytea,
  created_at   timestamptz not null default now()
);
create index on session_blocks (session_id, ordinal);

-- Aggregated pattern statistics (the hot table) ------------------------
create table pattern_stats (
  user_id      uuid not null references profiles(id) on delete cascade,
  pattern      text not null,
  pattern_type text not null,        -- 'key'|'bigram'|'trigram'|'class'
  n            int not null default 0,
  ewma_log_iki real not null,
  ewma_var     real not null default 0,
  accuracy     real not null default 1,
  last_seen    timestamptz not null,
  primary key (user_id, pattern_type, pattern)
);

-- Fitted attribution model --------------------------------------------
create table model_params (
  user_id      uuid primary key references profiles(id) on delete cascade,
  fitted_at    timestamptz not null,
  n_obs        int not null,
  coefficients jsonb not null,       -- { mu, kappa:{}, phi:{}, eta:{}, sigma, rho:{}, delta:{} }
  std_errors   jsonb not null,
  tradeoff     jsonb not null,       -- { alpha, beta, vControl, vCollapse, r2 }
  engine_version text not null
);

-- SRS -----------------------------------------------------------------
create table srs_items (
  user_id     uuid not null references profiles(id) on delete cascade,
  pattern     text not null,
  pattern_type text not null,
  stability   real not null,
  difficulty  real not null,
  reps        int not null default 0,
  lapses      int not null default 0,
  state       text not null,
  target_iki  real not null,
  last_review timestamptz,
  due_at      timestamptz not null,
  primary key (user_id, pattern_type, pattern)
);
create index on srs_items (user_id, due_at);

-- Curriculum ----------------------------------------------------------
create table curriculum_state (
  user_id       uuid primary key references profiles(id) on delete cascade,
  track         text not null,
  unit          text not null,
  unlocked_chars text not null,
  stage_by_pattern jsonb not null default '{}'::jsonb,
  completed_units text[] not null default '{}',
  updated_at    timestamptz not null default now()
);

-- Diagnoses (one per session, plus on-demand) --------------------------
create table diagnoses (
  id          uuid primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  session_id  uuid references sessions(id) on delete cascade,
  kind        text not null,          -- 'session'|'plateau'|'habit'
  findings    jsonb not null,         -- Finding[]
  prescription jsonb,
  narration   text,                   -- LLM or template output
  narration_source text not null,     -- 'llm'|'template'
  created_at  timestamptz not null default now()
);

-- Plans ---------------------------------------------------------------
create table plans (
  id          uuid primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  source_diagnosis uuid references diagnoses(id),
  sessions_planned int not null,
  sessions_done    int not null default 0,
  spec        jsonb not null,
  status      text not null default 'active',
  created_at  timestamptz not null default now()
);

-- Skill profile history ------------------------------------------------
create table skill_snapshots (
  user_id   uuid not null references profiles(id) on delete cascade,
  taken_at  timestamptz not null,
  speed real, accuracy real, consistency real,
  rhythm real, weak_key real, punctuation real, overall real,
  score_version int not null,
  primary key (user_id, taken_at)
);

-- Achievements ---------------------------------------------------------
create table achievements (
  user_id   uuid not null references profiles(id) on delete cascade,
  key       text not null,
  earned_at timestamptz not null default now(),
  meta      jsonb,
  primary key (user_id, key)
);
```

**RLS:** every table has `user_id = auth.uid()` policies for select/insert/update. No exceptions. Service-role key is used only in the cron aggregation route and never exposed to the client.

### 20.2 Keystroke storage strategy

A 15-minute session at 80 WPM is roughly 6,000 keystrokes. Stored naively as JSON that is ~1 MB per session — unaffordable.

**Strategy:**
- Store per block as **columnar typed arrays**: `t` as `Int32Array` of deltas from block start, `code` as `Uint8Array` of layout-map indices, `flags` as `Uint8Array` bitfield. ~7 bytes/keystroke before compression, ~3 bytes after gzip.
- 6,000 keystrokes ≈ **18 KB compressed per session**. A heavy user doing 300 sessions/year uses ~5 MB. Acceptable.
- **Retention:** raw blobs kept for the last `90` ⚙️ days or `200` ⚙️ sessions, whichever is larger. Older sessions keep aggregates only (`pattern_stats`, `sessions`, `skill_snapshots`), which is all the product needs long-term. Users can export raw data before expiry (§22.2).

### 20.3 Cron jobs (Vercel Cron)

| Job | Schedule | Purpose |
|---|---|---|
| `aggregate` | hourly | Roll up `pattern_stats`, refresh materialized dashboard views |
| `srs-forecast` | daily 03:00 UTC | Precompute due counts for the next 14 days |
| `retention-prune` | daily | Drop expired keystroke blobs |
| `plateau-scan` | daily | Flag plateaued users so the home screen can offer "Why am I stuck?" proactively |

---

## 21. Non-functional requirements

### 21.1 Performance

| Requirement | Target |
|---|---|
| Keystroke → visual feedback | ≤ 16 ms p99 (measured in CI) |
| Zero dropped frames during typing | 60 fps sustained; no GC pause > 8 ms during a block |
| Time to interactive (landing) | ≤ 1.5 s on 4G mid-tier device |
| First session startable | ≤ 10 s from landing |
| Content generation for next buffer | ≤ 20 ms, off main thread |
| Ridge refit (20k observations) | ≤ 400 ms in worker |
| Session ingest API p95 | ≤ 500 ms |
| Dashboard load p95 | ≤ 1.2 s |
| Lighthouse performance (app shell) | ≥ 90 |

### 21.2 Reliability

- A network failure must never lose a completed session (§19.5).
- A worker crash must not end the session; fall back to between-block analysis.
- Corrupt or implausible timing data (system clock jumps, throttled tabs) must be detected and excluded, with the session marked `timing_suspect` rather than discarded.

### 21.3 Browser support

Latest 2 versions of Chrome, Edge, Firefox, Safari on desktop. Mobile: dashboard and history read-only; the typing surface shows a "desktop keyboard required" state rather than a broken experience.

### 21.4 Internationalization

V1 English UI, English + code corpora. All UI strings externalized from day one (`next-intl`) so that adding languages is a content task, not a refactor. Layout support is independent of UI language.

### 21.5 Accessibility

WCAG 2.2 AA for all non-typing surfaces. Contrast ≥ 4.5:1. Focus visible. Keyboard escape from the typing field (`Esc` then `Tab`). Reduced-motion respected.

---

## 22. Privacy, security, content licensing

### 22.1 The keystroke-dynamics problem — treat this seriously

Keystroke timing data is **biometrically identifying**. It can be used to fingerprint an individual across sites, and in some analyses to infer stress or fatigue. We are collecting a lot of it. This deserves an explicit posture, not boilerplate.

**Commitments:**
- Raw keystroke data is never sold, shared with third parties, or used for advertising. Ever.
- No keystroke data is captured outside an active training block. The app has no global key listener, no clipboard access, and no capture on any input field other than the training surface.
- Any aggregate data used to improve population priors is k-anonymized (`k ≥ 50` ⚙️) and stripped of session-level timing.
- This is stated plainly in the privacy policy and, more importantly, on the onboarding screen in one sentence. It is a differentiator, not a liability.

### 22.2 User data rights

- **Export:** full JSON export of all sessions, blocks (including raw keystroke arrays), stats, and diagnoses, on demand, no support ticket.
- **Delete:** account deletion removes all rows within 30 days; cascade is enforced by FK.
- **Anonymous mode:** the app is fully usable without an account, with data local-only.

### 22.3 Content licensing

Every corpus item carries `source`, `licence`, `attribution`. Acceptable sources:
- Public domain (Project Gutenberg, US government works)
- Permissively licensed (CC0, CC-BY with attribution rendered in an in-app credits page)
- Tatoeba sentences (CC-BY 2.0 FR) with attribution
- Code snippets: MIT/Apache-2.0 licensed repositories with attribution, or synthetically generated idiomatic snippets that we author
- Our own written content

**No scraping of Keybr, Monkeytype, or any competitor's corpora.** Content licence audit is a release gate.

### 22.4 Security

- Supabase RLS on every table; deny-by-default.
- Anthropic API key server-side only; never in a client bundle or edge config readable by the client.
- Rate limiting on `/api/coach` and `/api/session` (per-user and per-IP).
- Input validation with Zod on every route handler; reject implausible sessions (e.g. 400 WPM, negative durations) and flag rather than store silently.
- Anti-cheat for any future leaderboard: replay validation from the keystroke stream (timing distributions of scripted input are trivially detectable). **[V2]**

---

## 23. Roadmap and acceptance criteria

### Phase 0 — Foundation (engine skeleton)

**Scope:** `packages/engine` capture + metrics + layout maps. Typing surface with correct input path. No accounts, no adaptivity. A working, beautiful typing test.

**Acceptance:**
- [ ] Keystroke capture passes the timing-fidelity test suite (Appendix B) with < 1 ms error vs a synthetic input harness
- [ ] Keystroke → paint ≤ 16 ms p99 measured in CI
- [ ] WPM/accuracy/consistency match hand-computed golden fixtures exactly
- [ ] All 5 layouts resolve `code → char/hand/finger/row` correctly (unit tested)
- [ ] Session survives tab blur, key repeat, and a 30 s idle without corrupt data

### Phase 1 — V1: The Coach (the shippable product)

**Scope:** everything needed to deliver D1, D2, D3 for a single user.

- Ridge attribution model + counterfactual costs (§7)
- Speed–accuracy tradeoff curve, `V_control` / `V_collapse`
- Skill Profile, six dimensions + composite (§8)
- SRS scheduler, both tiers (§9)
- Content ladder stages 0–5 + generators + promotion gates (§10)
- Curriculum with progressive unlocking (§11)
- **Autopilot** (§12) with 5/10/15/25-minute variants
- Real-time within-session adaptation (§13)
- Coach Mode + **"Why am I stuck?"** (§14)
- Bad-habit detection: visual search, hand imbalance, backspace thrash, overdriving (§15 — 4 of 9 detectors)
- Training modes: Autopilot, Fix Weaknesses, Speed, Precision, Muscle Memory, Real World
- Visibility modes, all five (§16.2)
- Typing profiles: Developer, Writer, Student, Office worker, Data entry
- Onboarding with calibration and first diagnosis (§18.2)
- Home screen, typing surface, session report, Typing Health dashboard
- Supabase auth + sync + offline-first
- LLM narration with template fallback
- Data export

**Acceptance:**
- [ ] A brand-new user reaches a personalized first diagnosis in ≤ 3 minutes
- [ ] Autopilot produces a valid, varied, non-repeating 15-min plan from any model state, including cold start
- [ ] Every displayed Finding has confidence ≥ medium and a reproducible computation (verifiable via session replay)
- [ ] Mid-session re-targeting visibly occurs within 4 s of a ranking change, and never mutates already-visible text
- [ ] Promotion/demotion gates verified against synthetic-typist scenarios (Appendix C)
- [ ] "Why am I stuck?" returns a ranked, quantified diagnosis with a one-click plan for ≥ 8 distinct simulated plateau profiles
- [ ] Full session completes offline and syncs on reconnect with no data loss
- [ ] LLM output validator rejects any fabricated number; template path is exercised in CI
- [ ] Skill scores are stable: replaying the same session twice yields identical scores
- [ ] Success metrics instrumented end-to-end (§4.3)

### Phase 2 — V2: Depth and social

- Remaining habit detectors (§15.1)
- Duel mode: async ghost race, then live
- Multilingual profile + non-English corpora (ES, FR, DE, PT)
- Layout-migration curriculum (QWERTY → Colemak)
- Endurance, Pressure, Experiment, Marathon modes
- Custom text import ("train on my own documents")
- Public profile / shareable Skill Profile card
- Population-prior model trained on real aggregate data, replacing the literature prior
- Leaderboards with replay-based anti-cheat
- Browser extension: measure real typing in the wild, feed the model **[investigate privacy implications first — this is the highest-risk feature in the document]**

### Phase 3 — V3: Platform

- Teams / classrooms: cohort dashboards, assigned plans
- Coach-facing API
- Mobile companion (dashboard, streaks, plan review; no typing)
- CJK / IME training
- Ergonomics module: break scheduling, RSI-risk signals, posture prompts
- Personalized corpus generation from the user's own writing samples

---

## 24. Risks and open questions

### 24.1 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Attribution overreach** — we confidently tell a user their pinky is the problem and we are wrong. This destroys the entire value proposition | **Critical** | Confidence gating (§7.7), ridge shrinkage toward priors, honest hedging language, and validation against the synthetic typist where ground truth is known |
| **Browser timing precision** — throttling, `performance.now()` coarsening (Spectre mitigations), key-repeat artifacts, OS-level input lag | High | Timing hygiene rules (§6.2), CI fidelity harness, `timing_suspect` flagging, and never claiming precision beyond ~1 ms |
| **Cold start** — a new user has no data, so the first diagnosis is the weakest one, and it is also the most important one for conversion | High | Coverage-engineered calibration (§18.2), strong population priors, explicit "early estimate" framing |
| **Overfitting to drills** — the user gets great at our drills and no faster at real typing | High | Untargeted speed-test block as the only trend metric (§12.2 invariant); transfer blocks at stage 5; measure gains on real prose |
| **Cost of LLM narration at scale** | Medium | Template-first design, aggressive caching, Haiku-class model, hard rate limits (§19.6) |
| **Content licensing** | Medium | Licence field mandatory; release gate audit (§22.3) |
| **RSI / overuse** — a streak mechanic that hurts people | Medium | Weekly streaks not daily (§17.5); volume caps and rest prompts (§12.3) |
| **Scope** — this document describes a lot of product | High | Phase 1 is genuinely shippable alone; every V2/V3 item is severable |
| **Keystroke-data reputation risk** | Medium | Explicit posture (§22.1), stated up front, never quietly |

### 24.2 Open questions

1. **Free vs paid.** Is this free forever (portfolio/reputation project), free with an optional paid tier (unlimited history, custom corpora, teams), or paid from day one? This affects storage retention policy and LLM budget. *Recommendation: free V1, decide at ~1,000 WAU.*
2. **Anonymous data retention.** How long do we keep local-only anonymous sessions before prompting for an account?
3. **Does the ridge model actually beat a simple per-bigram EWMA** at predicting IKI on held-out data? This should be validated empirically in Phase 0/1 with real data before we build the counterfactual UI on top of it. *If it does not beat the baseline, the entire diagnosis narrative needs rethinking — this is the highest-value experiment in the project.*
4. **Should `V_control` be the headline number instead of WPM?** It is arguably a truer measure of ability. Risky, because every other product shows WPM and users will compare.
5. **Target-speed philosophy.** Keybr trains toward a fixed target speed per key. Should we adopt a similar per-pattern target-speed mechanic inside blocks, or is our SRS target-IKI sufficient?
6. **Minimum viable corpus size** for stage 5 before repetition becomes noticeable. Estimate needed.

---

## 25. Appendices

### Appendix A — Formula reference

| Quantity | Formula |
|---|---|
| Net WPM | `(correctChars / 5) / activeMinutes` |
| Raw WPM | `(allChars / 5) / activeMinutes` |
| WPM ↔ mean IKI | `WPM = 12 / m` where `m` = mean IKI in seconds |
| Accuracy | `firstAttemptCorrect / totalPositions` |
| Consistency | `100 · clamp(1 − CV(wpm_per_sec), 0, 1)` |
| Rhythm | `100 · clamp(1 − MAD(ε)/0.90, 0, 1)` |
| Weak-key control | `100 · clamp(m_median / m_worst5, 0, 1)` |
| Punctuation | `100 · clamp(m_alpha / m_punct, 0, 1)` |
| Accuracy score | `100 · clamp((acc − 0.90)/0.10, 0, 1)^0.65` |
| Overall | `0.30·Sp + 0.25·Ac + 0.15·Co + 0.10·Rh + 0.12·Wk + 0.08·Pu` |
| Attribution | `log(IKI) = μ + κ_b + φ_f + η_hand + σ_sfb + ρ_row + δ_bigram + ε` |
| Counterfactual cost | `ΔWPM = 12/m_cf − 12/m_actual` |
| Counterfactual (closed form) | `ΔWPM ≈ WPM · f · (k − 1)` for share `f`, multiplier `k` |
| Error probability | `P(err) = logistic(α + β · localWPM)` |
| Motor retrievability | `r = (1 + Δ/(9S))^−0.4` |
| SRS interval | `Δ = effectiveS · 9 · (R_target^(−1/0.4) − 1)`; at `R_target = 0.85` ⇒ `4.51 · effectiveS` |
| Touch-typing confidence | `100 · clamp((wpm_h/wpm_v)·(acc_h/acc_v), 0, 1)` |

### Appendix B — Timing fidelity test harness

A CI test that drives synthetic `KeyboardEvent`s at known intervals (using CDP `Input.dispatchKeyEvent` under Playwright so events carry real trusted timestamps) and asserts:

- Recorded IKIs match dispatched intervals within `1 ms` mean absolute error
- No keystroke is dropped at 200 WPM equivalent (60 ms IKI)
- Key repeat is correctly excluded
- Tab blur mid-stream produces a clean pause boundary, not a 30-second IKI
- Recorded → paint latency measured via `requestAnimationFrame` timestamps, p99 ≤ 16 ms

### Appendix C — The synthetic typist (critical for development)

A simulated typist in `packages/engine/simulator` that generates realistic keystroke streams from a parameterized profile:

```ts
interface TypistProfile {
  baseIki: number;                    // ms
  fingerMultipliers: Record<Finger, number>;
  keyMultipliers: Record<string, number>;
  sfbPenalty: number;
  rowJumpPenalty: number;
  hesitationRate: number;
  errorRateAtSpeed: (wpm: number) => number;
  noiseSigma: number;                 // log-normal
  fatigueRate: number;
  learningRate: number;               // improves when trained on a pattern
}
```

**Why this matters more than it looks:**

1. It gives us **ground truth**. We know the simulated typist's right pinky is exactly 1.4× slow, so we can assert that the diagnosis engine recovers that coefficient. No other validation method is available to us.
2. It lets us test the **entire adaptive loop** — planner, generator, SRS, promotion gates — over 50 simulated sessions in seconds, without a human typing for a month.
3. It makes regression testing of engine changes possible: run the standard cohort of 20 typist profiles through 30 sessions and assert that outcomes did not degrade.

**Required simulated cohort:** the plateaued overdriver, the visual searcher, the hand-imbalanced typist, the punctuation-weak developer, the accurate-but-slow beginner, the fast-but-erratic burst typist, the rapidly-improving learner, the regressing/inconsistent user.

### Appendix D — Glossary of engine constants

All constants marked ⚙️ in this document live in `packages/engine/src/config.ts` as a single exported, typed, frozen object with a `configHash()` function. Changing any value bumps the hash, which is stored on every session, which is what makes historical comparisons honest after a tuning change.

---

*End of document.*
