import type { BtwSlot, ThemeLike, WidgetState } from "./types.ts";

const WIDTH = 54;
/** At most this many exchanges render in full; older ones only count in the header. */
const MAX_VISIBLE_SLOTS = 3;
/** Finished answers longer than this truncate with a hand-off hint (v0.2). */
const MAX_ANSWER_LINES = 12;
const CURSOR = " ▍";
/** While streaming with no answer yet, show only this many trailing thinking lines. */
const THINKING_TAIL_LINES = 3;

/**
 * Pure widget renderer: WidgetState + theme -> lines.
 * The caller joins with "\n" and wraps in a pi-tui Text component.
 */
export function buildWidgetLines(state: WidgetState, theme: ThemeLike): string[] {
  if (state.slots.length === 0 && !state.status) return [];

  const dim = (s: string) => theme.fg("dim", s);
  const accent = (s: string) => theme.fg("success", s);
  const warning = (s: string) => theme.fg("warning", s);
  const errorFg = (s: string) => theme.fg("error", s);
  const italic = (s: string) => theme.fg("dim", theme.italic(s));

  const lines: string[] = [];

  const title = state.mode === "tangent" ? " 💭 btw (tangent) " : " 💭 btw ";
  const hint = " /btw:clear to dismiss ";
  const pad = Math.max(1, WIDTH - title.length - hint.length);
  lines.push(dim(`╭${title}${"─".repeat(pad)}${hint}╮`));

  const done = state.slots.filter((s) => s.done && !s.error).length;
  const headerParts: string[] = [];
  if (done > 0) headerParts.push(`${done} exchange${done > 1 ? "s" : ""}`);
  if (state.modelLabel) {
    headerParts.push(state.modelOverridden ? `${state.modelLabel} (override)` : state.modelLabel);
  }
  if (state.thinkingLabel) headerParts.push(`thinking ${state.thinkingLabel}`);
  if (headerParts.length > 0 && (done > 0 || state.modelOverridden || state.thinkingLabel)) {
    lines.push(dim(`│ ${headerParts.join(" · ")}`));
  }

  const visible = state.slots.slice(-MAX_VISIBLE_SLOTS);
  visible.forEach((slot, i) => {
    if (i > 0 || headerParts.length > 0) lines.push(dim("│ ───"));
    renderSlot(slot, lines, { dim, accent, warning, errorFg, italic });
  });

  if (state.status) {
    lines.push(dim("│ ") + warning(state.status));
  }

  lines.push(dim(`╰${"─".repeat(WIDTH)}╯`));
  return lines;
}

interface Painters {
  dim: (s: string) => string;
  accent: (s: string) => string;
  warning: (s: string) => string;
  errorFg: (s: string) => string;
  italic: (s: string) => string;
}

function renderSlot(slot: BtwSlot, lines: string[], p: Painters): void {
  lines.push(p.dim("│ ") + p.accent("› ") + slot.question);

  if (slot.toolLine) {
    lines.push(p.dim("│ ") + p.warning(`⚙ ${slot.toolLine}`));
  }

  if (slot.thinking) {
    // Thinking is only shown transiently. A finished exchange collapses to a
    // one-line marker (the full reasoning is never useful above the editor and
    // would stack dozens of wrapped lines per exchange); while streaming with no
    // answer yet, show only the trailing lines with the cursor; once the answer
    // starts streaming, thinking disappears and the cursor rides the answer tail.
    if (slot.done) {
      const count = slot.thinking.split("\n").length;
      lines.push(p.dim(`│ 💭 thought ${count} line${count > 1 ? "s" : ""}`));
    } else if (!slot.answer) {
      const tail = slot.thinking.split("\n").slice(-THINKING_TAIL_LINES);
      tail.forEach((line, i) => {
        const cursor = i === tail.length - 1 ? p.warning(CURSOR) : "";
        lines.push(p.dim("│ ") + p.italic(line) + cursor);
      });
    }
  }

  if (slot.error) {
    lines.push(p.dim("│ ") + p.errorFg(`✗ ${slot.error}`));
    return;
  }

  if (slot.answer) {
    // Streaming answers stay untruncated (the tail is what matters while it
    // grows); finished long answers collapse so the widget never swallows
    // the editor — the full text is one /btw:inject away.
    let answerLines = slot.answer.split("\n");
    let truncated = 0;
    if (slot.done && answerLines.length > MAX_ANSWER_LINES) {
      truncated = answerLines.length - MAX_ANSWER_LINES;
      answerLines = answerLines.slice(0, MAX_ANSWER_LINES);
    }
    lines.push(p.dim("│ ") + answerLines[0]);
    if (answerLines.length > 1) {
      lines.push(answerLines.slice(1).join("\n"));
    }
    if (truncated > 0) {
      lines.push(p.dim(`│ … +${truncated} more lines — /btw:inject to hand the full thread to the main agent`));
    }
    if (!slot.done) {
      lines[lines.length - 1] += p.warning(CURSOR);
    }
  } else if (!slot.thinking && !slot.toolLine && !slot.done) {
    lines.push(p.dim("│ ") + p.warning("⏳ thinking..."));
  }
}
