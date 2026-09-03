import { THINKING_LEVELS, type BtwThinkingLevel, type ModelRef } from "./types.ts";

export interface ParsedBtwArgs {
  save: boolean;
  question: string;
}

/**
 * Extract leading `--save` / `-s` flags from a /btw argument string.
 * Only leading flags are treated as flags so a question containing "-s"
 * mid-sentence is never mangled.
 */
export function parseBtwArgs(raw: string): ParsedBtwArgs {
  let save = false;
  let rest = raw.trim();
  for (;;) {
    const match = /^(--save|-s)(\s+|$)/.exec(rest);
    if (!match) break;
    save = true;
    rest = rest.slice(match[0].length).trimStart();
  }
  return { save, question: rest };
}

export type ModelCommand =
  | { kind: "show" }
  | { kind: "clear" }
  | { kind: "set"; ref: ModelRef }
  | { kind: "error"; message: string };

/** Parse `/btw:model` arguments: empty=show, "clear", or "<provider> <model> <api>". */
export function parseModelArgs(raw: string): ModelCommand {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { kind: "show" };
  if (tokens.length === 1 && tokens[0]!.toLowerCase() === "clear") return { kind: "clear" };
  if (tokens.length === 3) {
    return { kind: "set", ref: { provider: tokens[0]!, id: tokens[1]!, api: tokens[2]! } };
  }
  return {
    kind: "error",
    message: "Usage: /btw:model [<provider> <model> <api> | clear]",
  };
}

export type ThinkingCommand =
  | { kind: "show" }
  | { kind: "clear" }
  | { kind: "set"; level: BtwThinkingLevel }
  | { kind: "error"; message: string };

/** Parse `/btw:thinking` arguments: empty=show, "clear", or a valid level. */
export function parseThinkingArgs(raw: string): ThinkingCommand {
  const token = raw.trim().toLowerCase();
  if (token === "") return { kind: "show" };
  if (token === "clear") return { kind: "clear" };
  if ((THINKING_LEVELS as readonly string[]).includes(token)) {
    return { kind: "set", level: token as BtwThinkingLevel };
  }
  return {
    kind: "error",
    message: `Usage: /btw:thinking [${THINKING_LEVELS.join(" | ")} | clear]`,
  };
}
