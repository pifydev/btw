/**
 * The one seed-path test that must touch pi: it runs a real role:"custom"
 * message through the actual convertToLlm from the pi dist to prove why saved
 * --save notes have to be filtered BEFORE conversion, not after.
 *
 * The rest of the src/ tests stay pi-free by design; this file may import pi
 * because that is exactly the behavior under test. Runs under `bun test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { BTW_NOTE } from "../src/persistence.ts";
import { buildSeedMessages } from "../src/seed.ts";
import type { LooseMessage } from "../src/types.ts";

// The shape buildSessionContext hands back: real AgentMessages, including a
// saved --save note stored as a role:"custom" message carrying BTW_NOTE.
const branchMessages = [
  { role: "user", content: [{ type: "text", text: "real question" }], timestamp: 1 },
  { role: "custom", customType: BTW_NOTE, content: "Q: saved thing?\n\nA: yes", timestamp: 2 },
  { role: "assistant", content: [{ type: "text", text: "real answer" }], stopReason: "stop", timestamp: 3 },
];

test("convertToLlm maps custom→user and drops customType, so a post-conversion filter can't work", () => {
  const converted = convertToLlm(branchMessages as never) as unknown as LooseMessage[];
  // Nothing survives conversion carrying customType — the old seed.ts filter was
  // dead code, and the note text leaks through untouched.
  assert.ok(converted.every((m) => m.customType === undefined));
  assert.ok(JSON.stringify(converted).includes("saved thing?"));
});

test("filtering btw-notes before convertToLlm keeps them out of the contextual seed", () => {
  const filtered = branchMessages.filter(
    (m) => (m as { customType?: string }).customType !== BTW_NOTE,
  );
  const main = convertToLlm(filtered as never) as unknown as LooseMessage[];
  const seed = buildSeedMessages(main, [], "contextual", { id: "m", provider: "p" });
  assert.ok(!JSON.stringify(seed).includes("saved thing?"), JSON.stringify(seed));
  // the real user turn is still seeded
  assert.ok(JSON.stringify(seed).includes("real question"));
});
