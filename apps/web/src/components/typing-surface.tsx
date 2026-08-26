"use client";

import { useEffect, useRef, useState } from "react";
import type { VisibilityMode } from "@typing-trainer/engine";
import { TypingController, type ControllerOptions, type InputPolicy } from "@/lib/typing/controller";

export interface TypingSurfaceProps {
  targetText: string;
  policy?: InputPolicy;
  visibility?: VisibilityMode;
  /** Receives the live controller once mounted (session runner hooks in). */
  onController?: (controller: TypingController) => void;
  onComplete?: (controller: TypingController) => void;
  onProgress?: (typed: number, total: number) => void;
  onBatch?: (count: number) => void;
}

/**
 * The typing surface (PRD §18.5). The passage spans are created imperatively
 * by the TypingController and mutated directly on the rAF path (PRD §19.3);
 * React only owns the frame around them.
 */
export function TypingSurface({
  targetText,
  policy = "free",
  visibility = "keyboard_hidden",
  onController,
  onComplete,
  onProgress,
  onBatch,
}: TypingSurfaceProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const spanHostRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const scroll = scrollRef.current;
    const spanHost = spanHostRef.current;
    const caret = caretRef.current;
    if (!wrap || !scroll || !spanHost || !caret) return;

    const opts: ControllerOptions = {
      targetText,
      policy,
      showErrors: visibility !== "blind",
      onPauseChange: setPaused,
    };
    const controller = new TypingController(opts);
    opts.onComplete = () => onComplete?.(controller);
    if (onProgress) opts.onProgress = onProgress;
    if (onBatch) opts.onBatch = onBatch;
    controller.attach(spanHost, caret, scroll);
    onController?.(controller);

    // Expose for the Playwright timing-fidelity harness (PRD Appendix B).
    (window as unknown as Record<string, unknown>).__typing = controller;

    const onVisibilityChange = () => {
      if (document.hidden) controller.handleBlur();
    };
    wrap.addEventListener("keydown", controller.handleKeydown);
    wrap.addEventListener("keyup", controller.handleKeyup);
    wrap.addEventListener("compositionstart", controller.handleCompositionStart);
    wrap.addEventListener("compositionend", controller.handleCompositionEnd);
    wrap.addEventListener("blur", controller.handleBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    wrap.focus();

    return () => {
      wrap.removeEventListener("keydown", controller.handleKeydown);
      wrap.removeEventListener("keyup", controller.handleKeyup);
      wrap.removeEventListener("compositionstart", controller.handleCompositionStart);
      wrap.removeEventListener("compositionend", controller.handleCompositionEnd);
      wrap.removeEventListener("blur", controller.handleBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      controller.detach();
    };
    // The surface is intentionally rebuilt only when the passage changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetText, policy, visibility]);

  const textFaded = visibility === "text_faded";

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="textbox"
      aria-label="Typing area. Press Escape then Tab to leave."
      className="relative rounded-lg border border-border bg-surface p-6 outline-none focus:border-accent"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      data-testid="typing-surface"
    >
      <div className="relative overflow-hidden" style={{ height: "calc(3 * 2.2 * 18px)" }}>
        <div
          ref={scrollRef}
          className={`tc-passage relative transition-transform duration-150 ${textFaded ? "tc-text-faded" : ""}`}
        >
          <div ref={caretRef} className="tc-caret" data-testid="caret" aria-hidden />
          <div ref={spanHostRef} className="contents" />
        </div>
      </div>
      {(!focused || paused) && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-background/70 backdrop-blur-[2px]">
          <span className="text-sm text-muted">
            {paused ? "Paused — " : ""}click here to {paused ? "resume" : "start typing"}
          </span>
        </div>
      )}
    </div>
  );
}
