import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BTW_EXCHANGE,
  BTW_MODEL_OVERRIDE,
  BTW_RESET,
  BTW_THINKING_OVERRIDE,
  replayBranch,
} from "../src/persistence.ts";
import type { BranchEntryLike } from "../src/types.ts";

function custom(customType: string, data: unknown): BranchEntryLike {
  return { type: "custom", customType, data };
}

function exchange(question: string, answer: string): BranchEntryLike {
  return custom(BTW_EXCHANGE, { question, answer, thinking: "", timestamp: 1 });
}

test("empty branch yields defaults", () => {
  assert.deepEqual(replayBranch([]), {
    mode: "contextual",
    thread: [],
    modelOverride: null,
    thinkingOverride: null,
  });
});

test("exchanges after the last reset survive; earlier ones do not", () => {
  const state = replayBranch([
    exchange("old", "answer"),
    custom(BTW_RESET, { timestamp: 2, mode: "contextual" }),
    exchange("q1", "a1"),
    exchange("q2", "a2"),
  ]);
  assert.equal(state.thread.length, 2);
  assert.equal(state.thread[0]!.question, "q1");
  assert.equal(state.thread[1]!.question, "q2");
});

test("reset fixes the mode; tangent is preserved", () => {
  const state = replayBranch([custom(BTW_RESET, { timestamp: 1, mode: "tangent" })]);
  assert.equal(state.mode, "tangent");
  const fallback = replayBranch([custom(BTW_RESET, { timestamp: 1, mode: "bogus" })]);
  assert.equal(fallback.mode, "contextual");
});

test("overrides apply cumulatively: set then clear", () => {
  const state = replayBranch([
    custom(BTW_MODEL_OVERRIDE, { action: "set", provider: "openai", id: "gpt-5-mini", api: "x" }),
    custom(BTW_THINKING_OVERRIDE, { action: "set", thinkingLevel: "low" }),
    custom(BTW_MODEL_OVERRIDE, { action: "clear" }),
  ]);
  assert.equal(state.modelOverride, null);
  assert.equal(state.thinkingOverride, "low");
});

test("overrides survive resets (reset clears the thread, not settings)", () => {
  const state = replayBranch([
    custom(BTW_THINKING_OVERRIDE, { action: "set", thinkingLevel: "high" }),
    custom(BTW_RESET, { timestamp: 1, mode: "contextual" }),
  ]);
  assert.equal(state.thinkingOverride, "high");
});

test("malformed entries are skipped, valid ones kept", () => {
  const state = replayBranch([
    custom(BTW_EXCHANGE, null),
    custom(BTW_EXCHANGE, { question: "", answer: "a" }),
    custom(BTW_EXCHANGE, { question: "q" }),
    custom(BTW_THINKING_OVERRIDE, { action: "set", thinkingLevel: "ultra" }),
    custom(BTW_MODEL_OVERRIDE, { action: "set", provider: "p" }),
    exchange("good", "answer"),
    { type: "message" },
    { type: "custom" },
  ]);
  assert.equal(state.thread.length, 1);
  assert.equal(state.thread[0]!.question, "good");
  assert.equal(state.thinkingOverride, null);
  assert.equal(state.modelOverride, null);
});

test("non-btw custom entries are ignored", () => {
  const state = replayBranch([custom("other-extension", { question: "q", answer: "a" })]);
  assert.equal(state.thread.length, 0);
});
