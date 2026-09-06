# Manual smoke checklist

Run inside a real pi TUI session (`pi -e /path/to/btw` or after `pi install .`).
These paths need a live model + full runtime and are not unit-testable.

## Verified against a live model

Checked 2026-09-06 against `openrouter/qwen3-235b-a22b-2507`, driving the real
side-session machinery (`buildSeedMessages` → `createAgentSession` with
`READ_ONLY_TOOLS` → `sanitizeAnswer`) outside the TUI:

- [x] Extension loads without errors — `pi -p "hi"` with all 14 suite
      extensions installed answers normally, no stray output, exit 0
- [x] Side agent answers from the codebase and uses read-only tools
      (observed `ls` and `read`; nothing else was ever offered)
- [x] Read-only enforcement: asked to edit README, nothing on disk changed
- [x] Second question sees the first (thread continuity through the seed)
- [x] `/btw:tangent` does not know main-session facts; contextual mode does
      (same question, same seed, opposite answers)
- [x] `/btw:summarize` produces a `<btw-summary>` payload and describes
      unmade changes as proposals rather than completed work
- [x] `/btw:inject` payload wraps the thread in `<btw-thread>` verbatim

### What that run found

The model had no write tool, so nothing was ever modified — but it *narrated*
the edit as done and emitted tool-call JSON as plain text, which the widget
showed and `/btw:summarize` then handed to the main agent as fact. Fixed in
three places, all covered by `test/sanitize.test.ts`:

1. the side-agent system prompt now states there is no edit/write/bash tool
   and that nothing written there touches the repository;
2. `stripFakeToolCalls` removes emitted tool-call syntax (fenced blocks are
   left alone, so quoting a real `package.json` still works);
3. `buildSummarizePrompt` tells the summarizer to describe proposals as
   proposals, and any answer still claiming a change gets a read-only footer.

## Still TUI-only

These need a human at a terminal — they are about rendering, streaming, and
key handling, none of which survive outside the interactive runtime:

- [ ] `/btw what does this repo do?` streams thinking + answer into the widget
- [ ] `⚙ read/grep/find/ls` tool lines appear while it works
- [ ] `/btw` works while the main agent is streaming a long task
- [ ] `/btw:clear` dismisses widget; `/btw:new` starts fresh
- [ ] `/reload` → widget and thread rehydrate from session entries
- [ ] `/btw:inject implement this` delivers as a follow-up when the main agent
      is busy; thread resets after
- [ ] `/btw:summarize` shows `⏳ summarizing...` while it runs
- [ ] `/btw --save note this` writes a visible note; main agent context does
      NOT contain it (ask it "what did my note say" → it should not know)
- [ ] `/btw:model` shows inherited; set to a cheap model; answers use it;
      `clear` reverts; override survives `/reload`
- [ ] `/btw:thinking low` + `/reload` → override persists
- [ ] Override model without credentials → warning + fallback to main model
- [ ] Windows: paths in read tool output render correctly in the widget
