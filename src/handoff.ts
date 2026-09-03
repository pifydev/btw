import type { BtwDetails } from "./types.ts";

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
  return `${lead}\n\n<btw-thread>\n${threadText}\n</btw-thread>`;
}

/** Content for /btw:summarize delivery — summary in <btw-summary> tags. */
export function buildSummaryContent(summary: string, instructions: string): string {
  const lead = instructions
    ? `Here's a summary of a side conversation I had. ${instructions}`
    : "Here's a summary of a side conversation I had:";
  return `${lead}\n\n<btw-summary>\n${summary.trim()}\n</btw-summary>`;
}

/** The prompt sent to the one-off summarizer session. */
export function buildSummarizePrompt(thread: BtwDetails[]): string {
  return [
    "Summarize this side conversation concisely. Preserve key decisions, plans, insights, and action items.",
    "Output only the summary, no preamble.",
    "",
    "<btw-thread>",
    formatThread(thread),
    "</btw-thread>",
  ].join("\n");
}

/** Visible session note content for a single --save exchange. */
export function buildSaveNote(d: BtwDetails): string {
  return `Q: ${d.question.trim()}\n\nA: ${d.answer.trim()}`;
}
