/**
 * Small pure guards for @pify/btw's async side-agent run.
 *
 * No pi imports (see src/types.ts): everything under src/ must typecheck and
 * run standalone under Node's built-in type stripping, without a pi host.
 */

/**
 * True when `session` is still the extension's active sub-session — i.e. no
 * `/btw clear|new|model|thinking|inject` fired mid-prompt and cleared
 * (`active === null`) or replaced (`active.session !== session`) the thread.
 *
 * The async run captures its session locally before `await prompt(...)` and
 * re-checks this before finalizing (writing the slot, pendingThread, or the
 * btw-exchange entry); finalizing a stale session would resurrect a thread the
 * user has already cleared.
 */
export function isActiveSession<S>(active: { session: S } | null, session: S): boolean {
  return active !== null && active.session === session;
}
