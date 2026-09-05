import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWidgetLines } from "../src/widget.ts";
import type { BtwSlot, ThemeLike, WidgetState } from "../src/types.ts";

/** Identity theme: makes assertions on plain text possible. */
const theme: ThemeLike = {
  fg: (_color, text) => text,
  italic: (text) => text,
};

function slot(overrides: Partial<BtwSlot>): BtwSlot {
  return { question: "q", thinking: "", answer: "", toolLine: null, done: false, ...overrides };
}

function state(overrides: Partial<WidgetState>): WidgetState {
  return {
    slots: [],
    mode: "contextual",
    status: null,
    modelLabel: null,
    modelOverridden: false,
    thinkingLabel: null,
    ...overrides,
  };
}

test("empty state renders nothing (widget cleared)", () => {
  assert.deepEqual(buildWidgetLines(state({}), theme), []);
});

test("border carries title and dismiss hint; tangent is labeled", () => {
  const lines = buildWidgetLines(state({ slots: [slot({ done: true, answer: "a" })] }), theme);
  assert.ok(lines[0]!.includes("💭 btw"));
  assert.ok(lines[0]!.includes("/btw:clear to dismiss"));
  assert.ok(lines[0]!.startsWith("╭"));
  assert.ok(lines[lines.length - 1]!.startsWith("╰"));

  const tangent = buildWidgetLines(
    state({ mode: "tangent", slots: [slot({ done: true, answer: "a" })] }),
    theme,
  );
  assert.ok(tangent[0]!.includes("💭 btw (tangent)"));
});

test("only the last 3 slots render; header counts completed exchanges", () => {
  const slots = [1, 2, 3, 4, 5].map((i) => slot({ question: `q${i}`, answer: `a${i}`, done: true }));
  const lines = buildWidgetLines(state({ slots }), theme);
  const text = lines.join("\n");
  assert.ok(!text.includes("› q1"));
  assert.ok(!text.includes("› q2"));
  assert.ok(text.includes("› q3"));
  assert.ok(text.includes("› q5"));
  assert.ok(text.includes("5 exchanges"));
});

test("streaming slot shows cursor on thinking before any answer", () => {
  const lines = buildWidgetLines(
    state({ slots: [slot({ thinking: "pondering" })] }),
    theme,
  );
  const text = lines.join("\n");
  assert.ok(text.includes("pondering ▍"));
});

test("streaming cursor moves to the answer tail once text arrives", () => {
  const lines = buildWidgetLines(
    state({ slots: [slot({ thinking: "t", answer: "partial answer" })] }),
    theme,
  );
  const text = lines.join("\n");
  assert.ok(text.includes("partial answer ▍"));
  assert.ok(!text.includes("t ▍"));
});

test("done slot has no cursor", () => {
  const lines = buildWidgetLines(
    state({ slots: [slot({ answer: "final", done: true })] }),
    theme,
  );
  assert.ok(!lines.join("\n").includes("▍"));
});

test("placeholder before any delta; tool line while a tool runs", () => {
  const waiting = buildWidgetLines(state({ slots: [slot({})] }), theme);
  assert.ok(waiting.join("\n").includes("⏳ thinking..."));

  const tooling = buildWidgetLines(
    state({ slots: [slot({ toolLine: 'grep {"pattern":"x"}' })] }),
    theme,
  );
  const text = tooling.join("\n");
  assert.ok(text.includes("⚙ grep"));
  assert.ok(!text.includes("⏳"));
});

test("error slot renders ✗ and suppresses the answer path", () => {
  const lines = buildWidgetLines(
    state({ slots: [slot({ error: "model exploded", done: true })] }),
    theme,
  );
  assert.ok(lines.join("\n").includes("✗ model exploded"));
});

test("header shows override labels", () => {
  const lines = buildWidgetLines(
    state({
      slots: [slot({ answer: "a", done: true })],
      modelLabel: "openai/gpt-5-mini",
      modelOverridden: true,
      thinkingLabel: "low",
    }),
    theme,
  );
  const text = lines.join("\n");
  assert.ok(text.includes("openai/gpt-5-mini (override)"));
  assert.ok(text.includes("thinking low"));
});

test("status line renders while summarizing", () => {
  const lines = buildWidgetLines(
    state({ slots: [slot({ answer: "a", done: true })], status: "⏳ summarizing..." }),
    theme,
  );
  assert.ok(lines.join("\n").includes("⏳ summarizing..."));
});

test("multi-line answers keep the border only on the first line", () => {
  const lines = buildWidgetLines(
    state({ slots: [slot({ answer: "line1\nline2\nline3", done: true })] }),
    theme,
  );
  const text = lines.join("\n");
  assert.ok(text.includes("│ line1"));
  assert.ok(text.includes("line2\nline3"));
});

test("long finished answers truncate with a hand-off hint; streaming does not", () => {
  const long = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
  const done = buildWidgetLines(
    state({ slots: [slot({ answer: long, done: true })] }),
    theme,
  ).join("\n");
  assert.ok(done.includes("line 12"));
  assert.ok(!done.includes("line 13"));
  assert.ok(done.includes("+8 more lines"));
  assert.ok(done.includes("/btw:inject"));

  const streaming = buildWidgetLines(state({ slots: [slot({ answer: long })] }), theme).join("\n");
  assert.ok(streaming.includes("line 20"));
  assert.ok(!streaming.includes("more lines —"));
});
