import type { BtwSlot, ThemeLike, WidgetState } from "./types.ts";

const WIDTH = 54;
/** At most this many exchanges render in full; older ones only count in the header. */
const MAX_VISIBLE_SLOTS = 3;
const CURSOR = " ▍";

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
    const cursor = !slot.answer && !slot.done ? p.warning(CURSOR) : "";
    lines.push(p.dim("│ ") + p.italic(slot.thinking) + cursor);
  }

  if (slot.error) {
    lines.push(p.dim("│ ") + p.errorFg(`✗ ${slot.error}`));
    return;
  }

  if (slot.answer) {
    const answerLines = slot.answer.split("\n");
    lines.push(p.dim("│ ") + answerLines[0]);
    if (answerLines.length > 1) {
      lines.push(answerLines.slice(1).join("\n"));
    }
    if (!slot.done) {
      lines[lines.length - 1] += p.warning(CURSOR);
    }
  } else if (!slot.thinking && !slot.toolLine && !slot.done) {
    lines.push(p.dim("│ ") + p.warning("⏳ thinking..."));
  }
}
