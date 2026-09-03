/**
 * Local structural types for @pify/btw.
 *
 * Deliberately NO imports from pi packages: everything under src/ must
 * typecheck and run standalone so `node --test` can execute it with Node's
 * built-in type stripping, without a pi host installed.
 */

export type BtwMode = "contextual" | "tangent";

/** Mirrors ThinkingLevel from @earendil-works/pi-agent-core (7 levels). */
export type BtwThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const THINKING_LEVELS: readonly BtwThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** A completed side-conversation exchange (persisted as a btw-exchange entry). */
export interface BtwDetails {
  question: string;
  thinking: string;
  answer: string;
  provider: string;
  model: string;
  api: string;
  thinkingLevel: string;
  timestamp: number;
}

/** Widget rendering state for one exchange; the last slot may be streaming. */
export interface BtwSlot {
  question: string;
  thinking: string;
  answer: string;
  /** Transient "⚙ tool …" line while the sub-agent runs a read-only tool. */
  toolLine: string | null;
  done: boolean;
  error?: string;
}

export interface ModelRef {
  provider: string;
  id: string;
  api: string;
}

/** State reconstructed from the session branch on session_start/session_tree. */
export interface BtwRestoredState {
  mode: BtwMode;
  thread: BtwDetails[];
  modelOverride: ModelRef | null;
  thinkingOverride: BtwThinkingLevel | null;
}

/** Minimal theme surface used by the widget builder (subset of pi-tui Theme). */
export interface ThemeLike {
  fg(color: string, text: string): string;
  italic(text: string): string;
}

/** Everything buildWidgetLines needs to render. */
export interface WidgetState {
  slots: BtwSlot[];
  mode: BtwMode;
  /** Transient status line, e.g. "⏳ summarizing...". */
  status: string | null;
  /** Human labels shown in the header when overrides are active. */
  modelLabel: string | null;
  modelOverridden: boolean;
  thinkingLabel: string | null;
}

/**
 * Loose shape of an LLM-projected message, as produced by pi's convertToLlm.
 * Only the fields seed logic inspects; everything else passes through.
 */
export interface LooseMessage {
  role?: string;
  content?: unknown;
  customType?: string;
  stopReason?: unknown;
  [key: string]: unknown;
}

/** Loose shape of a session branch entry, as returned by getBranch(). */
export interface BranchEntryLike {
  type?: string;
  customType?: string;
  data?: unknown;
  [key: string]: unknown;
}
