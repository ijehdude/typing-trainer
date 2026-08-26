import type { Keystroke } from "@typing-trainer/engine";
import { MOD_ALT, MOD_CTRL, MOD_META, MOD_SHIFT } from "@typing-trainer/engine";

/**
 * The performance-critical input path (PRD §19.3).
 *
 * The keydown handler does nothing but read the timestamp synchronously,
 * write into a preallocated ring buffer, update O(1) cursor state, and
 * schedule a rAF. All rendering happens in the rAF callback by mutating
 * character spans directly — never through a React re-render of the passage.
 */

export type InputPolicy = "free" | "strict";

export interface ControllerOptions {
  targetText: string;
  policy: InputPolicy;
  /** blind mode: no live correctness feedback (PRD §16.2). */
  showErrors: boolean;
  onProgress?: (typedChars: number, totalChars: number) => void;
  onComplete?: () => void;
  onPauseChange?: (paused: boolean) => void;
}

const CAPACITY = 1 << 15; // 32768 keystrokes ≫ any single block

const enum Flag {
  Correct = 1,
  Correction = 2,
  Repeat = 4,
}

export class TypingController {
  private readonly opts: ControllerOptions;
  private readonly target: string;

  // Preallocated columnar ring buffer — no allocation on the hot path.
  private readonly bufT = new Float64Array(CAPACITY);
  private readonly bufTUp = new Float64Array(CAPACITY).fill(NaN);
  private readonly bufKey: string[] = new Array<string>(CAPACITY).fill("");
  private readonly bufCode: string[] = new Array<string>(CAPACITY).fill("");
  private readonly bufIndex = new Int32Array(CAPACITY);
  private readonly bufFlags = new Uint8Array(CAPACITY);
  private readonly bufMods = new Uint8Array(CAPACITY);
  private count = 0;

  /** Per-position display state: 0 untyped, 1 correct, 2 error. */
  private readonly posState: Uint8Array;
  /** Typed character per position (errors display the typed char, §18.5). */
  private readonly posTyped: string[];
  private readonly dirty: Int32Array;
  private dirtyCount = 0;

  private cursor = 0;
  private rafScheduled = false;
  private paused = false;
  private composing = false;
  private done = false;
  private escapeArmed = false; // Esc then Tab leaves the field (§21.5)

  private spans: HTMLElement[] = [];
  private caretEl: HTMLElement | null = null;
  private scrollEl: HTMLElement | null = null;
  private lastKeydownT = 0;

  /** keystroke→paint latencies (ms) for the CI harness (Appendix B). */
  readonly paintLatencies: number[] = [];

  constructor(opts: ControllerOptions) {
    this.opts = opts;
    this.target = opts.targetText;
    this.posState = new Uint8Array(this.target.length);
    this.posTyped = new Array<string>(this.target.length).fill("");
    this.dirty = new Int32Array(this.target.length + 8);
  }

  attach(spans: HTMLElement[], caretEl: HTMLElement, scrollEl: HTMLElement): void {
    this.spans = spans;
    this.caretEl = caretEl;
    this.scrollEl = scrollEl;
    this.markDirty(0);
    this.scheduleRender();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isDone(): boolean {
    return this.done;
  }

  /** HOT PATH — see PRD §19.3 for the prohibitions that apply here. */
  handleKeydown = (e: KeyboardEvent): void => {
    if (this.done || this.composing) return;
    if (typeof document !== "undefined" && document.hidden) return; // §6.2 rule 5
    if (e.ctrlKey || e.metaKey || e.altKey) return; // let shortcuts through

    let key = e.key;
    if (key === "Escape") {
      this.escapeArmed = true;
      return;
    }
    if (key === "Tab" && this.escapeArmed) return; // yield focus to the browser
    this.escapeArmed = false;
    if (key === "Enter") key = "\n";
    else if (key === "Tab") key = "\t";
    if (key.length > 1 && key !== "Backspace") return; // pure modifier / nav key

    e.preventDefault();
    if (this.paused) this.setPaused(false);

    const t = e.timeStamp; // DOMHighResTimeStamp, read synchronously (§6.2 rule 1)
    this.lastKeydownT = t;

    const i = this.count & (CAPACITY - 1);
    const isBackspace = key === "Backspace";
    const index = isBackspace ? Math.max(0, this.cursor - 1) : this.cursor;
    const expected = this.target.charCodeAt(index); // NaN-safe int compare
    const correct = !isBackspace && key.charCodeAt(0) === expected && key.length === 1;

    this.bufT[i] = t;
    this.bufKey[i] = key;
    this.bufCode[i] = e.code;
    this.bufIndex[i] = index;
    this.bufFlags[i] =
      (correct ? Flag.Correct : 0) | (isBackspace ? Flag.Correction : 0) | (e.repeat ? Flag.Repeat : 0);
    this.bufMods[i] =
      (e.shiftKey ? MOD_SHIFT : 0) | (e.ctrlKey ? MOD_CTRL : 0) | (e.altKey ? MOD_ALT : 0) | (e.metaKey ? MOD_META : 0);
    this.count++;

    if (isBackspace) {
      if (this.cursor > 0) {
        this.cursor--;
        this.posState[this.cursor] = 0;
        this.posTyped[this.cursor] = "";
        this.markDirty(this.cursor);
      }
    } else if (correct || this.opts.policy === "free") {
      this.posState[this.cursor] = correct ? 1 : 2;
      this.posTyped[this.cursor] = key;
      this.markDirty(this.cursor);
      this.cursor++;
      if (this.cursor >= this.target.length) this.done = true;
    } else {
      // strict mode: caret does not advance on error (§6.4)
      this.posState[this.cursor] = 2;
      this.posTyped[this.cursor] = key;
      this.markDirty(this.cursor);
    }

    this.scheduleRender();
  };

  handleKeyup = (e: KeyboardEvent): void => {
    // Record dwell on the most recent matching keydown (bounded backward scan).
    const upT = e.timeStamp;
    const start = this.count - 1;
    const lowest = Math.max(0, this.count - 8);
    for (let n = start; n >= lowest; n--) {
      const i = n & (CAPACITY - 1);
      if (this.bufCode[i] === e.code && Number.isNaN(this.bufTUp[i])) {
        this.bufTUp[i] = upT;
        break;
      }
    }
  };

  handleCompositionStart = (): void => {
    this.composing = true; // IME input fails safe, not dirty (§6.2 rule 6)
  };

  handleCompositionEnd = (): void => {
    this.composing = false;
  };

  handleBlur = (): void => {
    this.setPaused(true);
  };

  private setPaused(p: boolean): void {
    if (this.paused === p) return;
    this.paused = p;
    this.opts.onPauseChange?.(p);
  }

  private markDirty(index: number): void {
    if (this.dirtyCount < this.dirty.length) {
      this.dirty[this.dirtyCount++] = index;
    }
  }

  private scheduleRender(): void {
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    requestAnimationFrame(this.render);
  }

  private render = (): void => {
    this.rafScheduled = false;
    const showErrors = this.opts.showErrors;

    for (let d = 0; d < this.dirtyCount; d++) {
      const idx = this.dirty[d]!;
      const span = this.spans[idx];
      if (!span) continue;
      const state = this.posState[idx];
      if (state === 1) {
        span.className = "tc-ok";
        span.textContent = this.target[idx]!;
      } else if (state === 2 && showErrors) {
        span.className = "tc-err";
        // Show the typed character, not the expected one (§18.5).
        const typed = this.posTyped[idx]!;
        span.textContent = typed === "\n" || typed === "\t" || typed === " " ? this.target[idx]! : typed;
      } else if (state === 2) {
        span.className = "tc-ok"; // blind mode: no live feedback
        span.textContent = this.target[idx]!;
      } else {
        span.className = "tc-pending";
        span.textContent = this.target[idx]!;
      }
    }
    this.dirtyCount = 0;

    // Caret + line scroll (layout reads are allowed here, never in keydown).
    const cur = this.spans[Math.min(this.cursor, this.spans.length - 1)];
    if (cur && this.caretEl && this.scrollEl) {
      const left = cur.offsetLeft;
      const top = cur.offsetTop;
      this.caretEl.style.transform = `translate(${left}px, ${top}px)`;
      const lineH = cur.offsetHeight || 1;
      const line = Math.round(top / lineH);
      const scrollLine = Math.max(0, line - 1); // previous line stays visible (§18.5)
      this.scrollEl.style.transform = `translateY(${-scrollLine * lineH}px)`;
    }

    if (this.lastKeydownT > 0) {
      this.paintLatencies.push(performance.now() - this.lastKeydownT);
      this.lastKeydownT = 0;
    }

    this.opts.onProgress?.(this.cursor, this.target.length);
    if (this.done) this.opts.onComplete?.();
  };

  /** Materialize the ring buffer into engine keystrokes (off the hot path). */
  getKeystrokes(): Keystroke[] {
    const out: Keystroke[] = [];
    const n = Math.min(this.count, CAPACITY);
    for (let k = 0; k < n; k++) {
      const i = (this.count - n + k) & (CAPACITY - 1);
      const flags = this.bufFlags[i]!;
      const index = this.bufIndex[i]!;
      out.push({
        t: this.bufT[i]!,
        tUp: Number.isNaN(this.bufTUp[i]!) ? null : this.bufTUp[i]!,
        code: this.bufCode[i]!,
        key: this.bufKey[i]!,
        expected: this.target[index] ?? "",
        index,
        correct: (flags & Flag.Correct) !== 0,
        isCorrection: (flags & Flag.Correction) !== 0,
        repeat: (flags & Flag.Repeat) !== 0,
        modifiers: this.bufMods[i]!,
      });
    }
    return out;
  }
}
