/**
 * The side agent has read, grep, find and ls — nothing else. Asked to change
 * a file, some models do not refuse: they emit what a call to the tool they
 * wish they had would look like, as plain text, and narrate it as done.
 *
 * Nothing is written either way — the tool does not exist — but the widget
 * shows a lie, and /btw:inject and /btw:summarize would carry it into the
 * main session as fact. The system prompt asks models not to do this and the
 * good ones comply; this strips it from the ones that don't.
 */

/**
 * A line that is really a fragment of a tool call, not prose. Keys that show
 * up in ordinary JSON (`name`, `path`, `content`) are deliberately absent —
 * an answer quoting a package.json is not a tool call.
 */
const TOOL_CALL_FRAGMENT =
  /^\s*[`'"]*\s*\{?\s*"(tool|tool_name|tool_call|function|arguments|parameters|old_string|new_string)"\s*:/i;

/** Opening of a tool-call-shaped object, e.g. {"name": "write", ...}. */
const TOOL_CALL_OPENER = /\{\s*"(name|tool|tool_name|function)"\s*:\s*"(write|edit|bash|str_replace\w*|create\w*)"/i;

/** Closing braces/backticks left behind once the body is gone. */
const ORPHAN_CLOSER = /^\s*[`'"]*[}\]]+[`'"]*\s*,?\s*$/;

export const FAKE_TOOL_CALL_NOTE =
  "(The side agent tried to use a tool it does not have. This thread is read-only — hand the work to the main agent with /btw:inject.)";

export const READ_ONLY_FOOTER =
  "— read-only side conversation: nothing was changed. /btw:inject hands this to the main agent.";

/**
 * First-person claims of having made (or being about to make) a change.
 * Models narrate the edit they cannot perform; since a btw thread never
 * modifies anything, marking such an answer is always accurate.
 */
const CHANGE_VERB =
  "(?:update|edit|modify|create|write|rewrite|delete|remove|add|change|fix|run|apply)(?:d|ed|s|ing)?|wrote|written|ran|made";

const CHANGE_CLAIM = new RegExp(
  `\\b(?:i(?:'|’)?(?:ll|ve|m)?\\s+(?:will\\s+|have\\s+|has\\s+|am\\s+|just\\s+|now\\s+|go\\s+ahead\\s+and\\s+)*(?:${CHANGE_VERB})|let me (?:${CHANGE_VERB}))\\b`,
  "i",
);

/** Append the read-only footer when the answer claims a change. */
export function annotateUnmadeChanges(answer: string): string {
  const text = (answer ?? "").trim();
  if (!text || text === FAKE_TOOL_CALL_NOTE) return text;
  if (!CHANGE_CLAIM.test(text)) return text;
  if (text.includes(READ_ONLY_FOOTER)) return text;
  return `${text}\n\n${READ_ONLY_FOOTER}`;
}

/** What the extension applies to every finished side-agent answer. */
export function sanitizeAnswer(answer: string): string {
  return annotateUnmadeChanges(stripFakeToolCalls(answer));
}

/**
 * Remove emitted tool-call syntax from an answer, leaving the prose. Returns
 * the note when stripping leaves nothing behind, so the widget never shows an
 * empty answer where a fabricated edit used to be.
 */
export function stripFakeToolCalls(answer: string): string {
  const text = (answer ?? "").trim();
  if (!text) return text;
  const lines = text.split("\n");
  // The fragment anchors per line, so the cheap "is there anything to do"
  // check has to look at lines too, not at the answer as one string.
  if (!lines.some((line) => TOOL_CALL_FRAGMENT.test(line) || TOOL_CALL_OPENER.test(line))) return text;

  const kept: string[] = [];
  let depth = 0;
  let inFence = false;
  for (const line of lines) {
    // Fenced blocks are quoted content — an answer showing the user their own
    // package.json must survive intact.
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      kept.push(line);
      continue;
    }
    if (inFence) {
      kept.push(line);
      continue;
    }
    if (depth > 0) {
      // Inside a tool-call object: drop lines until the braces balance.
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      continue;
    }
    if (TOOL_CALL_OPENER.test(line)) {
      depth = Math.max(0, (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length);
      continue;
    }
    if (TOOL_CALL_FRAGMENT.test(line) || ORPHAN_CLOSER.test(line)) continue;
    kept.push(line);
  }

  const cleaned = kept
    .join("\n")
    .replace(/```(?:json)?\s*```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned || FAKE_TOOL_CALL_NOTE;
}
