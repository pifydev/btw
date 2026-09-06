# Smoke checklist

Most of this used to say "run it in a real pi TUI and look". Two of the three
reasons that was necessary are gone:

- `test/host.ts` is a stub pi host shaped after `ExtensionContext` in the pi
  source, so the extension can be loaded and driven directly. Which command
  ran, what it wrote to the session, and what it handed to `setWidget` are all
  observable without a terminal.
- `test/live/smoke.mjs` runs that same stub host against a **real model**, so
  the side-session, streaming, tool use and handoffs are exercised end to end.

What no stub can honestly claim is the terminal itself. Those items stay
manual, and are listed as such rather than quietly marked done.

## Automated in CI — `bun test`

`test/commands.test.ts` (no model, no network):

- [x] Every documented command is registered
- [x] `/reload` rehydrates the thread and the widget from session entries
- [x] `/btw:clear` dismisses the widget and records the reset
- [x] `/btw:new` starts a fresh thread
- [x] `/btw:tangent` with no question explains itself instead of silently
      changing how the next answer is produced
- [x] `/btw:model` reports, sets, persists across a reload, and reverts
- [x] `/btw:thinking` persists across a reload
- [x] `/btw:inject` hands `<btw-thread>` to the main agent and resets the thread
- [x] Commands are silent, not broken, without a UI
- [x] A saved note is a message the **context hook strips**, so it never
      reaches the model — the mechanism, not just the intent

## Automated against a live model — `bun run test/live/smoke.mjs`

Not part of `bun test`: it spends money and needs credentials. Last run
2026-09-06 against `openrouter/qwen3-235b-a22b-2507`, 20/20:

- [x] A question streams into the widget (166 render frames in that run)
- [x] Tool activity is shown while it works
- [x] The exchange is persisted; a second question continues the thread
- [x] Read-only holds: asked to edit a file, nothing on disk changed
- [x] No fabricated tool-call syntax reaches the widget
- [x] The answer does not claim a change it could not make
- [x] `--save` writes a visible note; nothing is handed to the main agent
- [x] `/btw:summarize` shows its status, injects `<btw-summary>`, and
      describes unmade changes as proposals
- [x] A model override without credentials warns and falls back to the main
      model, and the question is still answered
- [x] A reload rehydrates the thread; a handed-over thread comes back empty

## Still manual

A terminal, a keyboard, and a person:

- [ ] The widget renders correctly in the TUI — borders, colors, wrapping, and
      Windows paths in read output
- [ ] `ctrl+alt+p` opens the composer, and `Esc` behaves during a streaming answer
- [ ] `/btw` while the main agent is streaming: the answer arrives without
      disturbing the main transcript, and the note/inject path delivers as a
      follow-up rather than interrupting
- [ ] Long-session feel: the widget stays readable as the thread grows

## Running the live suite

```bash
# whatever provider/model you have credentials for
PI_LIVE_PROVIDER=openrouter PI_LIVE_MODEL=qwen/qwen3-235b-a22b-2507 \
  bun run test/live/smoke.mjs
```

It builds its own throwaway repo in a temp directory, so it never touches
your working tree.
