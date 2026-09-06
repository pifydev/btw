/**
 * The live half of test/smoke.md: the real extension, the real side-session,
 * a real model — driven through the stub host so every widget frame,
 * notification and session entry is observable.
 *
 * Not part of `bun test`: it spends money and needs credentials.
 *
 *   bun run test/live/smoke.mjs
 *
 * Uses whatever provider/model you pass, defaulting to the session default:
 *   PI_LIVE_PROVIDER=openrouter PI_LIVE_MODEL=qwen/qwen3-235b-a22b-2507 \
 *     bun run test/live/smoke.mjs
 */
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import btw from "../../extensions/btw.ts";
import { StubHost } from "../host.ts";
import { BTW_EXCHANGE, BTW_NOTE } from "../../src/persistence.ts";

const PROVIDER = process.env.PI_LIVE_PROVIDER ?? "openrouter";
const MODEL_ID = process.env.PI_LIVE_MODEL ?? "qwen/qwen3-235b-a22b-2507";

const model = {
  id: MODEL_ID,
  name: MODEL_ID,
  api: "openai-completions",
  provider: PROVIDER,
  baseUrl: "https://openrouter.ai/api/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0.09, output: 0.45, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 262144,
  maxTokens: 8192,
};

const repo = mkdtempSync(join(tmpdir(), "pify-btw-live-"));
mkdirSync(join(repo, "src"), { recursive: true });
writeFileSync(join(repo, "src", "flags.js"), 'export function parseFlags(argv) {\n  return argv.filter((a) => a.startsWith("--"));\n}\n');
writeFileSync(join(repo, "README.md"), "# demo-app\n\nA tiny CLI that parses flags.\n");

const results = [];
function check(label, condition, detail = "") {
  results.push(Boolean(condition));
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function load(opts = {}) {
  const host = new StubHost({ cwd: repo, model, ...opts });
  btw(host.api);
  return host;
}

// ── 1. A question streams into the widget and uses read-only tools ─────
const host = load();
await host.fire("session_start");
await host.run("btw", "what does this repo do? read the files first");

const frames = host.ui.filter((c) => c.method === "setWidget" && c.key === "btw");
const text = host.widgetText("btw");
console.log("\n--- final widget ---\n" + text.slice(0, 600) + "\n");
check("widget rendered the answer", /flag/i.test(text));
check("widget updated while streaming", frames.length > 2, `${frames.length} frames`);
check(
  "tool activity was shown while it worked",
  frames.some((f) => /read|grep|find|ls/i.test((f.lines ?? []).join("\n"))),
);
check("the exchange was persisted", host.entriesOf(BTW_EXCHANGE).length === 1);

// ── 2. A second question continues the same thread ─────────────────────
await host.run("btw", "what was my first question?");
const followUp = host.widgetText("btw");
check("thread continuity across questions", /repo|do|read/i.test(followUp));
check("both exchanges persisted", host.entriesOf(BTW_EXCHANGE).length === 2);

// ── 3. Read-only: it cannot edit, and never claims it did ──────────────
await host.run("btw", "edit README.md so it says hi instead");
const editAnswer = host.widgetText("btw");
const readme = readFileSync(join(repo, "README.md"), "utf8");
check("README on disk is untouched", readme.includes("tiny CLI"));
check("no fabricated tool-call syntax in the answer", !/"arguments"\s*:|"tool_name"/.test(editAnswer));
check(
  "the answer does not claim a completed change",
  /read-only side conversation: nothing was changed|cannot|can't|unable|do not have|don't have/i.test(editAnswer),
);

// ── 4. --save writes a note the main agent never sees ──────────────────
await host.run("btw", "--save one sentence: what does parseFlags return?");
// A note is a visible message carrying customType BTW_NOTE — the context
// hook is what keeps it out of the model's view (see the unit test).
const notes = host.sent.filter((m) => m.customType === BTW_NOTE);
check("a visible note was written", notes.length === 1);
check("the note is displayed to the user", notes[0]?.display === true);
check("nothing was handed to the main agent as a prompt", host.userMessages.length === 0);

// Snapshot before the summarize step, which resets the thread by design.
const entriesBeforeSummarize = [...host.entries];

// ── 5. Summarize shows its status, then injects a tagged summary ───────
const beforeSummary = host.ui.length;
await host.run("btw:summarize", "implement this");
const duringSummary = host.ui.slice(beforeSummary);
check(
  "the summarizing status was shown",
  duringSummary.some((c) => /summariz/i.test((c.lines ?? []).join("\n") + (c.message ?? ""))),
);
const summary = host.userMessages.at(-1) ?? "";
check("a <btw-summary> reached the main agent", summary.includes("<btw-summary>"));
check("the summary carries the instructions", summary.includes("implement this"));
check(
  "the summary does not assert an edit was made",
  !/\b(updated|edited|changed|rewrote)\b.*README/i.test(summary) || /propos/i.test(summary),
  summary.slice(0, 160),
);

// ── 6. A model override without credentials warns and falls back ───────
const fallbackHost = load({
  registry: { "anthropic/nope-4-5": { id: "nope-4-5", provider: "anthropic" } },
  credentialed: [],
});
await fallbackHost.fire("session_start");
await fallbackHost.run("btw:model", "anthropic nope-4-5 anthropic-messages");
await fallbackHost.run("btw", "say OK");
const warned = fallbackHost.notifications().some((n) => /falling back|no credentials/i.test(n));
check("an uncredentialed override warns", warned, fallbackHost.notifications().at(-1));
check("and the question is still answered by the main model", fallbackHost.widgetText("btw").length > 0);

// ── 7. Reload rehydrates from the entries the run produced ─────────────
const reloaded = load();
reloaded.entries.push(...entriesBeforeSummarize);
await reloaded.fire("session_start");
check("thread and widget rehydrate after a reload", /flag/i.test(reloaded.widgetText("btw")));

// And after a summarize, the reset is what rehydrates — an emptied thread.
const afterHandoff = load();
afterHandoff.entries.push(...host.entries);
await afterHandoff.fire("session_start");
check("a handed-over thread comes back empty", afterHandoff.widget("btw") === null);

rmSync(repo, { recursive: true, force: true });
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} live checks passed`);
process.exitCode = passed === results.length ? 0 : 1;
