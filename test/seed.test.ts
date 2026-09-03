import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeedMessages, sanitizeMainMessages } from "../src/seed.ts";
import type { BtwDetails, LooseMessage } from "../src/types.ts";

const MODEL = { id: "m", provider: "p" };

function exchange(question: string, answer: string): BtwDetails {
  return {
    question,
    answer,
    thinking: "",
    provider: "p",
    model: "m",
    api: "",
    thinkingLevel: "low",
    timestamp: 1,
  };
}

function textOf(message: LooseMessage): string {
  const content = message.content as Array<{ text?: string }>;
  return content?.[0]?.text ?? "";
}

test("tangent mode excludes main messages entirely", () => {
  const main: LooseMessage[] = [{ role: "user", content: [{ type: "text", text: "main" }] }];
  const seed = buildSeedMessages(main, [], "tangent", MODEL);
  assert.equal(seed.length, 0);
});

test("contextual mode includes sanitized main messages", () => {
  const main: LooseMessage[] = [
    { role: "user", content: [{ type: "text", text: "main" }] },
    { role: "assistant", content: [{ type: "text", text: "reply" }], stopReason: "stop" },
  ];
  const seed = buildSeedMessages(main, [], "contextual", MODEL);
  assert.equal(seed.length, 2);
});

test("continuation marker pair appears only when the thread is non-empty", () => {
  const none = buildSeedMessages([], [], "contextual", MODEL);
  assert.equal(none.length, 0);

  const seed = buildSeedMessages([], [exchange("q", "a")], "contextual", MODEL);
  assert.equal(seed.length, 4);
  assert.ok(textOf(seed[0]!).includes("separate side conversation"));
  assert.equal(seed[1]!.role, "assistant");
  assert.equal(textOf(seed[2]!), "q");
  assert.equal(textOf(seed[3]!), "a");
});

test("thread is appended in tangent mode too (thread continuity)", () => {
  const seed = buildSeedMessages(
    [{ role: "user", content: [{ type: "text", text: "main" }] }],
    [exchange("q", "a")],
    "tangent",
    MODEL,
  );
  // no main messages, but the thread block is present
  assert.equal(seed.length, 4);
  assert.ok(textOf(seed[0]!).includes("side conversation"));
});

test("sanitize drops trailing in-progress assistant message", () => {
  const messages: LooseMessage[] = [
    { role: "user", content: [{ type: "text", text: "u" }] },
    { role: "assistant", content: [{ type: "text", text: "partial" }] },
  ];
  const out = sanitizeMainMessages(messages);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.role, "user");
});

test("sanitize keeps completed trailing assistant message", () => {
  const messages: LooseMessage[] = [
    { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" },
  ];
  assert.equal(sanitizeMainMessages(messages).length, 1);
});

test("sanitize drops btw-note custom messages anywhere", () => {
  const messages: LooseMessage[] = [
    { role: "user", content: [{ type: "text", text: "u" }] },
    { role: "user", customType: "btw-note", content: [{ type: "text", text: "note" }] },
    { role: "assistant", content: [{ type: "text", text: "a" }], stopReason: "stop" },
  ];
  const out = sanitizeMainMessages(messages);
  assert.equal(out.length, 2);
  assert.ok(out.every((m) => m.customType !== "btw-note"));
});
