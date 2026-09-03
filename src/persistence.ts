import {
  THINKING_LEVELS,
  type BranchEntryLike,
  type BtwDetails,
  type BtwMode,
  type BtwRestoredState,
  type BtwThinkingLevel,
  type ModelRef,
} from "./types.ts";

export const BTW_EXCHANGE = "btw-exchange";
export const BTW_RESET = "btw-reset";
export const BTW_MODEL_OVERRIDE = "btw-model-override";
export const BTW_THINKING_OVERRIDE = "btw-thinking-override";
/** Visible --save note; a custom MESSAGE (context-filtered), not an entry. */
export const BTW_NOTE = "btw-note";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asExchange(data: unknown): BtwDetails | null {
  if (!isRecord(data)) return null;
  if (typeof data.question !== "string" || data.question === "") return null;
  if (typeof data.answer !== "string" || data.answer === "") return null;
  return {
    question: data.question,
    answer: data.answer,
    thinking: typeof data.thinking === "string" ? data.thinking : "",
    provider: typeof data.provider === "string" ? data.provider : "",
    model: typeof data.model === "string" ? data.model : "",
    api: typeof data.api === "string" ? data.api : "",
    thinkingLevel: typeof data.thinkingLevel === "string" ? data.thinkingLevel : "",
    timestamp: typeof data.timestamp === "number" ? data.timestamp : 0,
  };
}

/**
 * Rebuild btw state by replaying custom entries in branch order.
 *
 * Entries are chronological within a branch, so replay is order-based, not
 * timestamp-based: a reset clears the thread accumulated so far and fixes the
 * mode; overrides apply cumulatively; malformed entries are skipped. This runs
 * on session_start AND session_tree (branch switches change which entries are
 * on the active branch).
 */
export function replayBranch(entries: BranchEntryLike[]): BtwRestoredState {
  let mode: BtwMode = "contextual";
  let thread: BtwDetails[] = [];
  let modelOverride: ModelRef | null = null;
  let thinkingOverride: BtwThinkingLevel | null = null;

  for (const entry of entries) {
    if (entry.type !== "custom" || typeof entry.customType !== "string") continue;
    const data = entry.data;

    switch (entry.customType) {
      case BTW_RESET: {
        thread = [];
        const m = isRecord(data) ? data.mode : undefined;
        mode = m === "tangent" ? "tangent" : "contextual";
        break;
      }
      case BTW_EXCHANGE: {
        const exchange = asExchange(data);
        if (exchange) thread.push(exchange);
        break;
      }
      case BTW_MODEL_OVERRIDE: {
        if (!isRecord(data)) break;
        if (data.action === "clear") {
          modelOverride = null;
        } else if (
          data.action === "set" &&
          typeof data.provider === "string" &&
          typeof data.id === "string" &&
          typeof data.api === "string"
        ) {
          modelOverride = { provider: data.provider, id: data.id, api: data.api };
        }
        break;
      }
      case BTW_THINKING_OVERRIDE: {
        if (!isRecord(data)) break;
        if (data.action === "clear") {
          thinkingOverride = null;
        } else if (
          data.action === "set" &&
          typeof data.thinkingLevel === "string" &&
          (THINKING_LEVELS as readonly string[]).includes(data.thinkingLevel)
        ) {
          thinkingOverride = data.thinkingLevel as BtwThinkingLevel;
        }
        break;
      }
      default:
        break;
    }
  }

  return { mode, thread, modelOverride, thinkingOverride };
}
