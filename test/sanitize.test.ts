import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAKE_TOOL_CALL_NOTE,
  READ_ONLY_FOOTER,
  sanitizeAnswer,
  stripFakeToolCalls,
} from "../src/sanitize.ts";

test("ordinary answers pass through untouched", () => {
  const answer = "The repo is a small CLI that parses flags.\n\nIt has one module, `src/flags.js`.";
  assert.equal(stripFakeToolCalls(answer), answer);
  assert.equal(stripFakeToolCalls(""), "");
  assert.equal(stripFakeToolCalls("   "), "");
});

test("strips the tool-call fragment models emit when asked to edit", () => {
  // observed live on openrouter/qwen3-235b, asked to edit README from /btw
  const live = [
    "I'll update the README.md file to contain just \"hi\".",
    "",
    ' "arguments": {"path": "README.md", "content": "hi\\n"}}',
  ].join("\n");
  const cleaned = stripFakeToolCalls(live);
  assert.ok(!cleaned.includes("arguments"));
  assert.ok(cleaned.includes("I'll update the README.md file"));
});

test("strips a whole tool-call object across lines", () => {
  const answer = [
    "Sure, here goes:",
    '{"name": "write",',
    '  "arguments": {',
    '    "path": "README.md",',
    '    "content": "hi"',
    "  }",
    "}",
    "Done.",
  ].join("\n");
  const cleaned = stripFakeToolCalls(answer);
  assert.equal(cleaned, "Sure, here goes:\nDone.");
});

test("an answer that is nothing but a fake call becomes the note", () => {
  const cleaned = stripFakeToolCalls('{"name": "edit", "arguments": {"path": "a.ts", "old_string": "x"}}');
  assert.equal(cleaned, FAKE_TOOL_CALL_NOTE);
  assert.ok(cleaned.includes("/btw:inject"));
});

test("legitimate JSON in an answer survives", () => {
  const answer = [
    "Your package.json currently reads:",
    "```json",
    '{"name": "demo-app", "version": "1.0.0"}',
    "```",
    "The version field is what npm publishes.",
  ].join("\n");
  assert.equal(stripFakeToolCalls(answer), answer);
});

test("prose about tools is not mistaken for a tool call", () => {
  const answer = 'I cannot edit files here — there is no "write" tool in this side conversation.';
  assert.equal(stripFakeToolCalls(answer), answer);
});

test("answers claiming a change get the read-only footer", () => {
  // observed live: the model narrates the edit it cannot perform
  const live = "I'll edit the README.md file to say \"hi\" instead.\n\nI'll now update this file.";
  const out = sanitizeAnswer(live);
  assert.ok(out.startsWith("I'll edit the README.md"));
  assert.ok(out.endsWith(READ_ONLY_FOOTER));
  assert.ok(sanitizeAnswer("I've updated src/flags.js.").includes(READ_ONLY_FOOTER));
  assert.ok(sanitizeAnswer("Let me create a test file for that.").includes(READ_ONLY_FOOTER));
});

test("plain answers get no footer", () => {
  const plain = "The repo parses CLI flags in src/flags.js.";
  assert.equal(sanitizeAnswer(plain), plain);
  const refusal = "I cannot edit files from a side conversation. The change would be: replace line 3.";
  assert.equal(sanitizeAnswer(refusal), refusal);
});

test("the footer is added once, and never to the fake-call note", () => {
  const once = sanitizeAnswer("I'll update it.");
  assert.equal(sanitizeAnswer(once), once);
  assert.equal(sanitizeAnswer('{"arguments": {"path": "a"}}'), FAKE_TOOL_CALL_NOTE);
});
