import { BTW_NOTE } from "./persistence.ts";
import type { BtwDetails, BtwMode, LooseMessage } from "./types.ts";

const CONTINUATION_USER =
  "[The following is a separate side conversation. Continue this thread.]";
const CONTINUATION_ASSISTANT = "Understood, continuing our side conversation.";

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export interface SeedModelRef {
  id: string;
  provider: string;
}

function userMessage(text: string): LooseMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function assistantMessage(text: string, model: SeedModelRef): LooseMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    model: model.id,
    provider: model.provider,
    api: "",
    usage: EMPTY_USAGE,
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

/**
 * Prepare the main-session messages for seeding a contextual btw sub-session:
 * - drop visible btw-note custom messages (the side channel must not see its
 *   own saved notes twice), and
 * - drop a trailing in-progress assistant message (stopReason missing) so a
 *   fork mid-stream never sees a truncated response (linioi).
 */
export function sanitizeMainMessages(messages: LooseMessage[]): LooseMessage[] {
  const filtered = messages.filter((m) => m.customType !== BTW_NOTE);
  const last = filtered[filtered.length - 1];
  if (
    last &&
    last.role === "assistant" &&
    (last.stopReason === undefined || last.stopReason === null)
  ) {
    return filtered.slice(0, -1);
  }
  return filtered;
}

/**
 * Build the seed message list for a new btw sub-session.
 * Contextual mode: sanitized main messages first. Tangent mode: none.
 * A non-empty prior thread is appended as a marked side-conversation block.
 */
export function buildSeedMessages(
  mainMessages: LooseMessage[],
  thread: BtwDetails[],
  mode: BtwMode,
  model: SeedModelRef,
): LooseMessage[] {
  const all: LooseMessage[] = mode === "contextual" ? sanitizeMainMessages(mainMessages) : [];

  if (thread.length > 0) {
    all.push(userMessage(CONTINUATION_USER));
    all.push(assistantMessage(CONTINUATION_ASSISTANT, model));
    for (const d of thread) {
      all.push(userMessage(d.question));
      all.push(assistantMessage(d.answer, model));
    }
  }

  return all;
}
