# @pify/btw

By-the-way side conversations for [pi](https://github.com/earendil-works/pi): ask a **read-only, codebase-aware side agent** anything while the main agent keeps working — without derailing the session or polluting its context.

Part of the [Pify suite](https://github.com/pifydev). Install with [`pify install btw`](https://github.com/pifydev/cli) or `pi install npm:@pify/btw`.

## Why

Halfway through a long task you want to know something — what does this helper actually do, is there a test for this path, why is that config shaped that way. Asking the main agent costs you twice: the question and its answer stay in the context forever, and the agent you interrupted now has to find its way back to what it was doing.

A side conversation answers the question somewhere else. It reads the same codebase, it never writes, and the main thread never sees it unless you decide it should.

## Commands

| Command | Description |
|---|---|
| `/btw [--save] <question>` | Ask in the current side thread, which inherits the main session's context. `--save` also writes the exchange as a visible session note. |
| `/btw:new [question]` | Start a fresh side thread. |
| `/btw:tangent [--save] <question>` | A contextless side thread — no main-session context, fresh perspective. Switching between `/btw` and `/btw:tangent` clears the thread. |
| `/btw:clear` | Dismiss the widget and clear the thread. |
| `/btw:inject [instructions]` | Send the full thread to the main agent — queued as a follow-up if it is busy — then reset. |
| `/btw:summarize [instructions]` | Summarise the thread with a model, send the summary to the main agent, then reset. |
| `/btw:model [<provider> <model> <api> \| clear]` | Show or set a BTW-only model override. |
| `/btw:thinking [off\|minimal\|low\|medium\|high\|xhigh\|max \| clear]` | Show or set a BTW-only thinking override. |

## How it works

Each side question runs in an in-memory pi sub-session, seeded in contextual mode with the main session's conversation. It inherits your project's system prompt and context files but loads **no extensions** — so it cannot recurse — and only read-only tools: `read`, `grep`, `find`, `ls`.

Answers stream into a widget above the editor, and it works while the main agent is busy.

Completed exchanges are persisted as hidden custom entries in the session file: visible to you in the widget, invisible to the main agent, and rebuilt into a thread on restart. Model and thinking overrides are persisted per session the same way.

Cancelling or clearing BTW aborts only the sub-session. It never touches the main agent's turn.

## Honest about what it cannot do

A model with no write tool will sometimes narrate the edit anyway, or print tool-call JSON as text. Nothing happens on disk, but the widget reads as though something did — and `/btw:summarize` would carry that fiction into the main session, where it becomes something the main agent believes.

So: emitted tool-call syntax is stripped, an answer that still claims a change gets a `read-only side conversation: nothing was changed` footer, and the summariser is instructed to describe proposals as proposals.

## Cheaper questions

`/btw:model` and `/btw:thinking` run side questions on a smaller model or a lower thinking level than the main thread. A question about where something lives does not need the model you are paying for the refactor.

## Development

```bash
bun install
bun test              # unit tests over the pure modules, plus command tests against a stub host
bunx tsc --noEmit     # strict typecheck, including the extension entry
pi -e .               # load into a live pi session
```

Requires Node >= 22.19.0 or Bun for development. At runtime pi loads the raw TypeScript through jiti.

## License

MIT © [Pify maintainers](https://github.com/pifydev)
