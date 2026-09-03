# @pify/btw

By-the-way side conversations for [pi](https://github.com/earendil-works/pi): ask a **read-only, codebase-aware side agent** anything while the main agent keeps working — without derailing the session or polluting its context.

Part of the [Pify suite](https://github.com/pifydev). Install with [`pify install btw`](https://github.com/pifydev/cli) or `pi install npm:@pify/btw`.

## What it does

- `/btw` opens a parallel side conversation that streams into a widget above the editor — it works while the main agent is busy.
- The side agent is a **real pi sub-session with read-only tools** (`read`, `grep`, `find`, `ls`): it answers from the code, not just the transcript, and can never run commands or modify files.
- The side thread stays **out of the main agent's LLM context** and survives `/reload` and restarts.
- `/btw:inject` / `/btw:summarize` hand the side thread (or a summary) back to the main agent when you're ready to act on it.
- `/btw:model` and `/btw:thinking` run side questions on a cheaper model or lower thinking level than the main thread.

## Commands

| Command | Description |
|---|---|
| `/btw [--save] <question>` | Ask in the current side thread (inherits main-session context). `--save` also writes the exchange as a visible session note. |
| `/btw:new [question]` | Start a fresh side thread. |
| `/btw:tangent [--save] <question>` | Contextless side thread — no main-session context, fresh perspective. Switching between `/btw` and `/btw:tangent` clears the thread. |
| `/btw:clear` | Dismiss the widget and clear the thread. |
| `/btw:inject [instructions]` | Send the full thread to the main agent (queued as follow-up if busy), then reset. |
| `/btw:summarize [instructions]` | LLM-summarize the thread, send the summary to the main agent, then reset. |
| `/btw:model [<provider> <model> <api> \| clear]` | Show or set a BTW-only model override. |
| `/btw:thinking [off\|minimal\|low\|medium\|high\|xhigh\|max \| clear]` | Show or set a BTW-only thinking override. |

## How it works

Each side question runs in an in-memory pi sub-session seeded (in contextual mode) with the main session's conversation. The sub-session inherits your project's system prompt and context files but loads **no extensions** (no recursion) and only read-only tools. Completed exchanges are persisted as hidden custom entries in the session file — visible to you in the widget, invisible to the main agent — and the thread is rebuilt from them on restart. Model/thinking overrides are persisted per session the same way.

Cancelling or clearing BTW aborts only the sub-session; it never touches the main agent's turn.

## Development

```bash
bun install
bun test              # 36 unit tests over the pure modules
bunx tsc --noEmit     # strict typecheck incl. the extension entry
pi -e .               # load into a live pi session for smoke testing
```

Tested with pi 0.84.4. Requires Node >= 22.19.0 (or Bun) on the development side; at runtime pi loads the raw TypeScript via jiti.

## License

MIT © [Pify maintainers](https://github.com/pifydev)
