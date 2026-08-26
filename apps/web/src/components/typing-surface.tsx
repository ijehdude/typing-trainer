"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TypingController, type InputPolicy } from "@/lib/typing/controller";

export interface TypingSurfaceProps {
  targetText: string;
  policy?: InputPolicy;
  showErrors?: boolean;
  /** Fired once when the passage is completed. */
  onComplete?: (controller: TypingController) => void;
  onProgress?: (typed: number, total: number) => void;
}

/**
 * The typing surface (PRD §18.5). React renders the passage spans exactly
 * once; every subsequent update is a direct DOM mutation performed by the
 * TypingController on the rAF path (PRD §19.3).
 */
export function TypingSurface({
  targetText,
  policy = "free",
  showErrors = true,
  onComplete,
  onProgress,
}: TypingSurfaceProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [focused, setFocused] = useState(false);
  const controllerRef = useRef<TypingController | null>(null);

  const chars = useMemo(() => [...targetText], [targetText]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const scroll = scrollRef.current;
    const caret = caretRef.current;
    if (!wrap || !scroll || !caret) return;

    const controller = new TypingController({
      targetText,
      policy,
      showErrors,
      onComplete: () => onComplete?.(controller),
      ...(onProgress ? { onProgress } : {}),
      onPauseChange: setPaused,
    });
    controllerRef.current = controller;

    const spans = Array.from(scroll.querySelectorAll<HTMLElement>("span[data-ch]"));
    controller.attach(spans, caret, scroll);

    // Expose for the Playwright timing-fidelity harness (PRD Appendix B).
    (window as unknown as Record<string, unknown>).__typing = controller;

    const onVisibility = () => {
      if (document.hidden) controller.handleBlur();
    };
    wrap.addEventListener("keydown", controller.handleKeydown);
    wrap.addEventListener("keyup", controller.handleKeyup);
    wrap.addEventListener("compositionstart", controller.handleCompositionStart);
    wrap.addEventListener("compositionend", controller.handleCompositionEnd);
    wrap.addEventListener("blur", controller.handleBlur);
    document.addEventListener("visibilitychange", onVisibility);
    wrap.focus();

    return () => {
      wrap.removeEventListener("keydown", controller.handleKeydown);
      wrap.removeEventListener("keyup", controller.handleKeyup);
      wrap.removeEventListener("compositionstart", controller.handleCompositionStart);
      wrap.removeEventListener("compositionend", controller.handleCompositionEnd);
      wrap.removeEventListener("blur", controller.handleBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // The surface is intentionally rebuilt only when the passage changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetText, policy, showErrors]);

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="textbox"
      aria-label="Typing area. Press Escape then Tab to leave."
      className="relative outline-none rounded-lg border border-border bg-surface p-6 focus:border-accent"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      data-testid="typing-surface"
    >
      <div className="relative overflow-hidden" style={{ height: "calc(3 * 2.2 * 18px)" }}>
        <div ref={scrollRef} className="tc-passage relative transition-transform duration-150">
          <div ref={caretRef} className="tc-caret" data-testid="caret" />
          {chars.map((ch, i) => (
            <span key={i} data-ch={i} className="tc-pending">
              {ch}
            </span>
          ))}
        </div>
      </div>
      {(!focused || paused) && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/70 backdrop-blur-[2px]">
          <span className="text-muted text-sm">
            {paused ? "Paused — " : ""}click or press any key to {paused ? "resume" : "start"}
          </span>
        </div>
      )}
    </div>
  );
}
