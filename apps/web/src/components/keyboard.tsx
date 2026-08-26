"use client";

import { useMemo } from "react";
import { getLayout } from "@typing-trainer/content";
import type { VisibilityMode } from "@typing-trainer/engine";

/**
 * On-screen keyboard (PRD §16.2): visible with next-key highlight, faded at
 * 25% opacity, or absent. A first-class training variable, not a cosmetic.
 */
export function Keyboard({
  layoutId,
  visibility,
  nextChar,
}: {
  layoutId: string;
  visibility: VisibilityMode;
  nextChar: string | null;
}) {
  const rows = useMemo(() => {
    const layout = getLayout(layoutId);
    const byRow = new Map<number, Array<{ code: string; char: string }>>();
    for (const def of Object.values(layout.keys)) {
      if (def.row === 4 || def.col < 0) continue;
      let arr = byRow.get(def.row);
      if (!arr) byRow.set(def.row, (arr = []));
      arr.push({ code: def.code, char: def.char });
    }
    for (const arr of byRow.values()) {
      const layoutRef = getLayout(layoutId);
      arr.sort((a, b) => layoutRef.keys[a.code]!.col - layoutRef.keys[b.code]!.col);
    }
    return [0, 1, 2, 3].map((r) => byRow.get(r) ?? []);
  }, [layoutId]);

  if (visibility === "keyboard_hidden" || visibility === "text_faded" || visibility === "blind") {
    return null;
  }

  const layout = getLayout(layoutId);
  const nextEntry = nextChar !== null ? layout.charIndex[nextChar.toLowerCase()] ?? layout.charIndex[nextChar] : undefined;
  const highlight = visibility === "keyboard_visible" ? nextEntry?.code : undefined;
  const faded = visibility === "keyboard_faded";

  return (
    <div
      aria-hidden
      className={`mx-auto mt-6 w-fit select-none ${faded ? "opacity-25" : ""}`}
      data-testid="onscreen-keyboard"
    >
      {rows.map((row, i) => (
        <div key={i} className="flex justify-center gap-1 pb-1" style={{ paddingLeft: i * 10 }}>
          {row.map((k) => (
            <div
              key={k.code}
              className={`flex h-8 w-8 items-center justify-center rounded border text-xs font-mono ${
                highlight === k.code
                  ? "border-accent bg-accent/20 text-accent"
                  : "border-border bg-surface-2 text-muted"
              }`}
            >
              {k.char === " " ? "␣" : k.char}
            </div>
          ))}
        </div>
      ))}
      <div className="flex justify-center pt-0.5">
        <div
          className={`h-8 w-64 rounded border ${
            nextChar === " " && highlight !== undefined
              ? "border-accent bg-accent/20"
              : "border-border bg-surface-2"
          }`}
        />
      </div>
    </div>
  );
}
