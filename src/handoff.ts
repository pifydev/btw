import type { BtwDetails } from "./types.ts";

/**
 * Injected thread text is data, and it travels inside a tagged block that
 * says so. A literal closing tag inside the thread would end the block early
 * and everything after it would arrive looking like this extension's own
 * framing rather than like quoted conversation — the same failure memory's
 * neutralizeBlockTags exists for, and a side thread can quote anything,
 * including text from a repository that wrote a closing tag on purpose.
 */
function neutralizeTags(text: string, tag: string): string {
  return text.replaceAll(new RegExp(`<(/?)${tag}(\\s[^>]*)?>`, "gi"), "&lt;$1" + tag + "$2&gt;");
}

/** Format the thread as User/Assistant exchanges (noahsaso format). */
export function formatThread(thread: BtwDetails[]): string {
  return thread
    .map((d) => `User: ${d.question.trim()}\nAssistant: ${d.answer.trim()}`)
    .join("\n\n---\n\n");
}

/** Content for /btw:inject — full thread in <btw-thread> tags. */
export function buildInjectContent(thread: BtwDetails[], instructions: string): string {
  const threadText = formatThread(thread);
  const lead = instructions
    ? `Here's a side conversation I had. ${instructions}`
    : "Here's a side conversation I had for additional context:";
  return `${lead}\n\n<btw-thread>\n${neutralizeTags(threadText, "btw-thread")}\n</btw-thread>`;
}

/** Content for /btw:summarize delivery — summary in <btw-summary> tags. */
export function buildSummaryContent(summary: string, instructions: string): string {
  const lead = instructions
    ? `Here's a summary of a side conversation I had. ${instructions}`
    : "Here's a summary of a side conversation I had:";
  return `${lead}\n\n<btw-summary>\n${neutralizeTags(summary.trim(), "btw-summary")}\n</btw-summary>`;
}

/** The prompt sent to the one-off summarizer session. */
export function buildSummarizePrompt(thread: BtwDetails[]): string {
  return [
    "Summarize this side conversation concisely. Preserve key decisions, plans, insights, and action items.",
    // The side agent has no write tools, so anything in the thread that reads
    // like a completed change is the model narrating something that never
    // happened. A summary must not pass that on to the main agent as fact.
    "The side conversation could not modify anything: describe proposals as proposals, and never state",
    "that a file was edited, created or run.",
    "Output only the summary, no preamble.",
    "",
    "<btw-thread>",
    neutralizeTags(formatThread(thread), "btw-thread"),
    "</btw-thread>",
  ].join("\n");
}

/** Visible session note content for a single --save exchange. */
export function buildSaveNote(d: BtwDetails): string {
  return `Q: ${d.question.trim()}\n\nA: ${d.answer.trim()}`;
}
