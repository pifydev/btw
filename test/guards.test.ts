/**
 * Regression tests for the async side-agent run guards (extensions/btw.ts).
 *
 * The finalize step after `await session.prompt(...)` must bail when a
 * mid-prompt /btw clear|new|model|thinking|inject has cleared or replaced the
 * active sub-session; otherwise it resurrects a thread the user cleared. The
 * decision is factored into isActiveSession so it can be checked here without a
 * live model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isActiveSession } from "../src/guards.ts";

test("isActiveSession: the running session is still the active one → finalize", () => {
  const s = { id: "s1" };
  assert.equal(isActiveSession({ session: s }, s), true);
});

test("isActiveSession: the thread was cleared mid-prompt (active === null) → bail", () => {
  const s = { id: "s1" };
  assert.equal(isActiveSession(null, s), false);
});

test("isActiveSession: the active session was replaced mid-prompt → bail", () => {
  const s = { id: "s1" };
  const replacement = { id: "s2" };
  assert.equal(isActiveSession({ session: replacement }, s), false);
});
