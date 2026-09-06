/**
 * The parts of test/smoke.md that were only ever manual because they need a
 * running extension: command routing, what each command writes to the
 * session, and what the widget is asked to show. The stub host (test/host.ts)
 * stands in for pi; the model is not involved, so these run in CI.
 *
 * What stays manual is what a stub cannot honestly claim: the terminal
 * itself, and the keyboard shortcut.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import btw from "../extensions/btw.ts";
import { StubHost } from "./host.ts";
import { BTW_EXCHANGE, BTW_MODEL_OVERRIDE, BTW_NOTE, BTW_RESET, BTW_THINKING_OVERRIDE } from "../src/persistence.ts";

function load(opts?: ConstructorParameters<typeof StubHost>[0]) {
  const host = new StubHost(opts);
  btw(host.api as never);
  return host;
}

/** A finished exchange, as the extension persists one. */
function exchange(question: string, answer: string) {
  return {
    type: "custom" as const,
    customType: BTW_EXCHANGE,
    data: { question, answer, mode: "contextual", thinking: "", model: "openai/gpt-5.5", timestamp: 1 },
  };
}

test("every documented command is registered", () => {
  const host = load();
  assert.deepEqual(
    [...host.commands.keys()].sort(),
    ["btw", "btw:clear", "btw:inject", "btw:model", "btw:new", "btw:summarize", "btw:tangent", "btw:thinking"].sort(),
  );
});

test("/reload rehydrates the thread and the widget from session entries", async () => {
  const host = load();
  host.entries.push(exchange("what does this repo do?", "It parses CLI flags."));
  host.entries.push(exchange("and the tests?", "bun test, node:test style."));

  // A fresh process is exactly this: a new extension instance replaying the
  // branch it finds.
  await host.fire("session_start");

  const text = host.widgetText("btw");
  assert.ok(text.includes("parses CLI flags"), text);
  assert.ok(text.includes("bun test"), text);
});

test("/btw:clear dismisses the widget and records the reset", async () => {
  const host = load();
  host.entries.push(exchange("q", "a"));
  await host.fire("session_start");
  assert.ok(host.widget("btw"));

  await host.run("btw:clear");
  assert.equal(host.widget("btw"), null, "widget should be cleared");
  assert.equal(host.entriesOf(BTW_RESET).length, 1);
});

test("/btw:new starts a fresh thread", async () => {
  const host = load();
  host.entries.push(exchange("q", "a"));
  await host.fire("session_start");

  await host.run("btw:new");
  assert.equal(host.widget("btw"), null);
  const resets = host.entriesOf(BTW_RESET) as Array<{ mode?: string }>;
  assert.equal(resets.at(-1)?.mode, "contextual");
  assert.match(host.notifications().at(-1)!, /fresh thread/);
});

test("/btw:tangent needs a question — the mode rides on the ask", async () => {
  const host = load();
  // Tangent is not a toggle: it is how one question is asked, so a bare
  // command explains itself instead of silently changing the next answer.
  await host.run("btw:tangent");
  assert.match(host.notifications().at(-1)!, /Usage: \/btw:tangent/);
  assert.equal(host.entriesOf(BTW_RESET).length, 0);
});

test("/btw:model reports, sets, persists, and reverts", async () => {
  const host = load({
    model: { id: "gpt-5.5", provider: "openai" },
    registry: { "anthropic/claude-haiku-4-5-20251001": { id: "claude-haiku-4-5-20251001", provider: "anthropic" } },
  });

  await host.run("btw:model");
  assert.match(host.notifications().at(-1)!, /inherits main thread/);

  await host.run("btw:model", "anthropic claude-haiku-4-5-20251001 anthropic-messages");
  assert.equal(host.entriesOf(BTW_MODEL_OVERRIDE).length, 1);
  await host.run("btw:model");
  assert.match(host.notifications().at(-1)!, /claude-haiku/);

  // the override is on the branch, so a new instance picks it up
  const reloaded = load({
    model: { id: "gpt-5.5", provider: "openai" },
    registry: { "anthropic/claude-haiku-4-5-20251001": { id: "claude-haiku-4-5-20251001", provider: "anthropic" } },
  });
  reloaded.entries.push(...host.entries);
  await reloaded.fire("session_start");
  await reloaded.run("btw:model");
  assert.match(reloaded.notifications().at(-1)!, /claude-haiku/, "override should survive a reload");

  await host.run("btw:model", "clear");
  await host.run("btw:model");
  assert.match(host.notifications().at(-1)!, /inherits main thread/);
});

test("/btw:thinking persists across a reload", async () => {
  const host = load();
  await host.run("btw:thinking", "low");
  assert.equal(host.entriesOf(BTW_THINKING_OVERRIDE).length, 1);

  const reloaded = load();
  reloaded.entries.push(...host.entries);
  await reloaded.fire("session_start");
  await reloaded.run("btw:thinking");
  assert.match(reloaded.notifications().at(-1)!, /low/);
});

test("/btw:inject hands the thread to the main agent and resets it", async () => {
  const host = load();
  host.entries.push(exchange("how does auth work?", "It reads a JWT in middleware."));
  await host.fire("session_start");

  await host.run("btw:inject", "implement this");
  const delivered = host.userMessages.at(-1)!;
  assert.ok(delivered.includes("<btw-thread>"));
  assert.ok(delivered.includes("how does auth work?"));
  assert.ok(delivered.includes("implement this"));
  // idle main agent → delivered directly; busy → as a follow-up
  assert.equal(host.userMessageOptions.at(-1), undefined);
  // the thread is handed over, so it starts empty afterwards
  assert.equal(host.widget("btw"), null);
  assert.ok(host.entriesOf(BTW_RESET).length >= 1);
});

test("commands are silent, not broken, without a UI", async () => {
  const host = load({ hasUI: false });
  host.entries.push(exchange("q", "a"));
  await host.fire("session_start");
  await host.run("btw:clear");
  await host.run("btw:model");
  assert.equal(host.ui.length, 0, "no UI calls should be attempted headlessly");
});

test("a note is a session entry, never part of the main agent's messages", async () => {
  const host = load();
  // The main agent sees messages; notes are custom entries, which is what
  // keeps a --save note out of its context.
  host.entries.push({ type: "custom", customType: BTW_NOTE, data: { text: "remember the deploy window" } });
  await host.fire("session_start");
  const noteEntries = host.entries.filter((e) => e.customType === BTW_NOTE);
  assert.equal(noteEntries.length, 1);
  assert.equal(host.userMessages.length, 0, "a note must not be handed to the main agent");
});

test("the context hook strips saved notes from what the model sees", async () => {
  const host = load();
  await host.fire("session_start");

  const handler = host.handlers.get("context")!;
  const messages = [
    { role: "user", content: [{ type: "text", text: "real prompt" }] },
    { role: "user", customType: BTW_NOTE, content: [{ type: "text", text: "btw note" }] },
    { role: "assistant", content: [{ type: "text", text: "answer" }] },
  ];
  const result = (await handler({ messages }, host.ctx)) as { messages?: unknown[] } | undefined;

  assert.ok(result?.messages, "the hook should rewrite the message list");
  assert.equal(result!.messages!.length, 2);
  assert.ok(!JSON.stringify(result!.messages).includes("btw note"));

  // nothing to strip → the hook leaves the list alone entirely
  const untouched = await handler({ messages: messages.slice(0, 1) }, host.ctx);
  assert.equal(untouched, undefined);
});
