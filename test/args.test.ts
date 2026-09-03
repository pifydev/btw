import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBtwArgs, parseModelArgs, parseThinkingArgs } from "../src/args.ts";

test("parseBtwArgs extracts leading --save/-s flags", () => {
  assert.deepEqual(parseBtwArgs("how does this work?"), {
    save: false,
    question: "how does this work?",
  });
  assert.deepEqual(parseBtwArgs("--save summarize the error"), {
    save: true,
    question: "summarize the error",
  });
  assert.deepEqual(parseBtwArgs("-s quick note"), { save: true, question: "quick note" });
  assert.deepEqual(parseBtwArgs("  --save   spaced  "), { save: true, question: "spaced" });
  // repeated flags collapse
  assert.deepEqual(parseBtwArgs("-s --save q"), { save: true, question: "q" });
});

test("parseBtwArgs never eats flags mid-question", () => {
  assert.deepEqual(parseBtwArgs("what does -s mean here?"), {
    save: false,
    question: "what does -s mean here?",
  });
  assert.deepEqual(parseBtwArgs("explain --save semantics"), {
    save: false,
    question: "explain --save semantics",
  });
});

test("parseBtwArgs handles empty input", () => {
  assert.deepEqual(parseBtwArgs(""), { save: false, question: "" });
  assert.deepEqual(parseBtwArgs("--save"), { save: true, question: "" });
});

test("parseModelArgs: show / clear / set / error", () => {
  assert.deepEqual(parseModelArgs(""), { kind: "show" });
  assert.deepEqual(parseModelArgs("  "), { kind: "show" });
  assert.deepEqual(parseModelArgs("clear"), { kind: "clear" });
  assert.deepEqual(parseModelArgs("CLEAR"), { kind: "clear" });
  assert.deepEqual(parseModelArgs("openai gpt-5-mini openai-responses"), {
    kind: "set",
    ref: { provider: "openai", id: "gpt-5-mini", api: "openai-responses" },
  });
  assert.equal(parseModelArgs("openai gpt-5-mini").kind, "error");
  assert.equal(parseModelArgs("a b c d").kind, "error");
});

test("parseThinkingArgs validates the 7-level union", () => {
  assert.deepEqual(parseThinkingArgs(""), { kind: "show" });
  assert.deepEqual(parseThinkingArgs("clear"), { kind: "clear" });
  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    assert.deepEqual(parseThinkingArgs(level), { kind: "set", level });
    assert.deepEqual(parseThinkingArgs(level.toUpperCase()), { kind: "set", level });
  }
  assert.equal(parseThinkingArgs("ultra").kind, "error");
  assert.equal(parseThinkingArgs("on").kind, "error");
});
