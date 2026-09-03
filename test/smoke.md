# Manual smoke checklist

Run inside a real pi TUI session (`pi -e /path/to/btw` or after `pi install .`).
These paths need a live model + full runtime and are not unit-testable.

- [ ] Extension loads without errors (`/reload` shows no btw errors)
- [ ] `/btw what does this repo do?` streams thinking + answer into the widget
- [ ] Side agent uses read-only tools: `⚙ read/grep/find/ls` lines appear
- [ ] Read-only enforcement: `/btw edit README to say hi` → agent explains it
      cannot modify files (no edit/write/bash available)
- [ ] `/btw` works while the main agent is streaming a long task
- [ ] Second `/btw` question sees the first (thread continuity)
- [ ] `/btw:tangent` does not know main-session facts; switching modes clears
- [ ] `/btw:clear` dismisses widget; `/btw:new` starts fresh
- [ ] `/reload` → widget and thread rehydrate from session entries
- [ ] `/btw:inject implement this` delivers `<btw-thread>` to main agent
      (as follow-up when busy); thread resets after
- [ ] `/btw:summarize` shows `⏳ summarizing...`, injects `<btw-summary>`
- [ ] `/btw --save note this` writes a visible note; main agent context does
      NOT contain it (ask main agent "what did my note say" → doesn't know)
- [ ] `/btw:model` shows inherited; set to a cheap model; answers use it;
      `clear` reverts; override survives `/reload`
- [ ] `/btw:thinking low` + `/reload` → override persists
- [ ] Override model without credentials → warning + fallback to main model
- [ ] `pi -p "hi"` (print mode) with extension loaded: no crash, no output
- [ ] Windows: paths in read tool output render correctly in the widget
