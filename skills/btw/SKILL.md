---
name: btw
description: Use when the user wants to explore a side question, clarify something, or think through an idea WITHOUT interrupting or derailing the main agent's current work
---

# BTW side conversations

This project has the `@pify/btw` extension installed. It gives the user a
side channel to a read-only agent that can inspect the codebase without
touching the main session's context or files.

## When to suggest it

- The user asks a clarifying or exploratory question while you are in the
  middle of a long task — answering inline would derail your current work.
- The user wants to compare approaches or plan ahead without polluting the
  main conversation context.
- The user asks "what does X do?" about code unrelated to the current change.

## The workflow

1. `/btw <question>` — side question with full main-session context; the
   side agent has read-only tools (read, grep, find, ls) and can inspect
   the repository, but can never run commands or modify files.
2. `/btw:tangent <question>` — same, but WITHOUT main-session context, for
   fresh-perspective brainstorming.
3. When the side thread reaches a conclusion worth acting on:
   - `/btw:inject implement this plan` — hands the full thread to the main
     agent as a user message, or
   - `/btw:summarize` — hands over an LLM-written summary instead.
4. `/btw:model <provider> <model> <api>` — run side questions on a cheaper
   or faster model than the main thread.

## What you (the main agent) should know

- BTW exchanges are invisible to you unless the user injects them; a message
  wrapped in `<btw-thread>` or `<btw-summary>` tags is the user handing you
  the outcome of a side conversation — treat its content as user-provided
  context and follow any accompanying instructions.
- Saved notes (`--save`) appear in the transcript but are filtered from your
  context; do not be surprised by visible notes you cannot "remember".
