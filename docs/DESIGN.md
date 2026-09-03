# @pify/btw v0.1 — Design

# Overview

`@pify/btw` is a pi package (repo `pifydev/btw`, npm `@pify/btw`) that adds a "by-the-way" side-conversation workflow to pi. The user asks side questions with `/btw` without derailing the main agent's turn. Answers stream into a **widget above the editor** (noahsaso-style). Unlike the original, the answering agent is a **real pi sub-session with read-only codebase tools** (`read`, `grep`, `find`, `ls`), so it answers from the code, not just the transcript. The side thread is hidden from the main LLM context, survives `/reload` via custom session entries, and can be handed back to the main agent via `/btw:inject` or `/btw:summarize`. Per-session model and thinking overrides let BTW run cheaper/faster than the main thread.

Synthesis of prior art: widget UI and slot model from noahsaso; abort-safety and in-progress-message stripping from linioi; read-only sub-agent concept from williamyangcn; sub-session construction, tangent mode, overrides, `--save`, skill, and persistence semantics from dbachelder (with tools narrowed from `["read","bash","edit","write"]` to read-only).

# Commands

All commands are registered with `pi.registerCommand(name, { description, handler })` (extensions.md).

**`/btw [--save|-s] <question>`**
Ask in the current thread (contextual mode: sub-session is seeded with main-session messages). If the current mode is `tangent`, switching to `/btw` first resets the thread (persisting a `btw-reset` with `mode: "contextual"`) — dbachelder semantics: **switching modes clears the thread**. No question → notify usage (`Usage: /btw [--save] <question>`); if a thread exists, re-render the widget. `--save` additionally appends a visible `btw-note` message to the main transcript after the answer completes (queued as `followUp` if the main agent is busy). If a BTW request is already streaming, reject with a notify ("BTW is busy — wait for the current answer or /btw:clear").

**`/btw:new [question]`**
Reset thread to a fresh contextual thread (persist `btw-reset`), then ask `question` if given; otherwise notify "Started a fresh BTW thread."

**`/btw:tangent [--save|-s] <question>`**
Contextless mode: sub-session gets **no** main-session messages, only the BTW system prompt (and read-only tools — it can still read code). If current mode is `contextual`, reset first (persist `btw-reset` with `mode: "tangent"`). Widget title shows `(tangent)`.

**`/btw:clear`**
Dispose the sub-session (abort + dispose), clear thread and widget, persist `btw-reset`.

**`/btw:inject [instructions]`**
Requires a non-empty thread, else warn. Formats the thread as `User:/Assistant:` exchanges inside `<btw-thread>` tags (noahsaso format), prefixed with optional instructions, and delivers via `pi.sendUserMessage(content)` when `ctx.isIdle()`, else `pi.sendUserMessage(content, { deliverAs: "followUp" })` (extensions.md § pi.sendUserMessage). On success: reset thread + clear widget, notify count. On failure: thread preserved, notify error.

**`/btw:summarize [instructions]`**
Requires a non-empty thread. Spawns a one-off summarizer sub-session — `createAgentSession` with `tools: []`, `thinkingLevel: "off"`, summarize-only system prompt — prompts it with the formatted thread, takes the text answer, wraps in `<btw-summary>` tags with optional instructions, delivers exactly like inject, then resets. Summarizer session is always aborted + disposed in a `finally` block.

**`/btw:model [<provider> <model> <api> | clear]`**
No args → show resolved model and source (`override` / `inherits main thread` / fallback reason). `clear` → drop override, persist `btw-model-override {action:"clear"}`. Three tokens → resolve via `ctx.modelRegistry.find(provider, id)`; unknown → error notify ("use /login or /models first"). On set: persist `btw-model-override {action:"set", provider, id, api}`, **dispose the sub-session but keep `pendingThread`** — the next question builds a fresh sub-session reseeded from the preserved hidden thread (dbachelder semantics). At question time, if the override has no credentials (`ctx.modelRegistry.getApiKeyAndHeaders`), fall back to `ctx.model` with a warning notify.

**`/btw:thinking [<level> | clear]`**
Levels validated against `off | minimal | low | medium | high` (confirm exact `ThinkingLevel` union from `@earendil-works/pi-ai` at implementation time). Same show/set/clear + persistence (`btw-thinking-override`) + dispose-but-preserve-thread semantics as `/btw:model`. Default: inherit `pi.getThinkingLevel()`.

# Architecture

## Module layout

```
btw/
├── extensions/
│   └── btw.ts          # thin entry: default-export factory (pi: ExtensionAPI) => void;
│                       # command/event/renderer registration, wiring only
├── src/
│   ├── types.ts        # local structural types (BtwDetails, BtwSlot, modes, override records)
│   │                   # — NO peer imports, so src/ typechecks and runs standalone
│   ├── args.ts         # parseBtwArgs (--save/-s), parseModelArgs, parseThinkingArgs   [pure]
│   ├── widget.ts       # buildWidgetLines(state, theme: ThemeLike): string[]           [pure]
│   ├── persistence.ts  # entry type constants; replayBranch(entries): RestoredState    [pure]
│   ├── handoff.ts      # formatThread, buildInjectContent, buildSummaryContent         [pure]
│   ├── seed.ts         # buildSeedMessages(mainMessages, thread, mode, model)          [pure]
│   └── session.ts      # sub-session lifecycle: create/ensure/dispose, resource loader
└── skills/btw/SKILL.md
```

**Entry file choice: `extensions/btw.ts`** (not root `index.ts`). Rationale: (a) matches pi's convention directory (`extensions/` auto-discovers) so the package still loads even if the manifest were dropped; (b) matches the dbachelder precedent; (c) combined with an explicit `pi.extensions: ["./extensions/btw.ts"]` manifest, helper modules under `src/` can never be accidentally loaded as separate extensions. Raw `.ts` is loaded via jiti per project convention; cross-file TS imports work.

## State model

In-memory state owned by the factory closure (module-level per extension instance):

- `pendingThread: BtwDetails[]` — completed exchanges since last reset; **source of truth** for inject/summarize and for reseeding sub-sessions.
- `mode: "contextual" | "tangent"`.
- `modelOverride: SessionModel | null`, `thinkingOverride: SessionThinkingLevel | null`.
- `slots: BtwSlot[]` — widget rendering state (`{question, thinking, answer, toolLine, done, error?}`); one slot per exchange, the last slot streams.
- `activeSession: { session: AgentSession; mode; unsubscribe: () => void } | null`.
- `lastUiCtx` — for re-rendering the widget from event handlers.

## Sub-session lifecycle

Created lazily per question via `ensureSession(ctx, mode)`; disposed on mode switch, override change, `/btw:clear`, error, and `session_shutdown`.

Exact APIs (pi 0.84.4):

```ts
import {
  buildSessionContext, createAgentSession, createExtensionRuntime,
  SessionManager, type AgentSession, type ExtensionAPI,
  type ExtensionCommandContext, type ResourceLoader,
} from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  model: resolved.model,                       // override else ctx.model
  modelRegistry: ctx.modelRegistry,
  thinkingLevel: resolved.thinkingLevel,       // override else pi.getThinkingLevel()
  tools: ["read", "grep", "find", "ls"],       // read-only — never bash/edit/write
  resourceLoader: makeBtwResourceLoader(ctx),
});
```

Citations:
- `createAgentSession(options)` and the `AgentSession` interface (`prompt`, `subscribe`, `abort`, `dispose`, `isStreaming`, `state.messages`): `docs/sdk.md` § "createAgentSession()" / "AgentSession".
- Read-only toolset: `docs/sdk.md` § "Tools" — built-in names are `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, `ls`; the docs' own "Read-only mode" example is exactly `tools: ["read", "grep", "find", "ls"]`. (pi has no `glob` tool; `find`/`ls` cover it.)
- `SessionManager.inMemory()`: `docs/sdk.md` — the sub-session's own transcript is ephemeral; durability comes from our custom entries.
- Custom `ResourceLoader` (dbachelder's `createBtwResourceLoader` pattern): returns empty extensions (`{extensions: [], errors: [], runtime: createExtensionRuntime()}`), empty skills/prompts/themes/agents files, `getSystemPrompt: () => stripDynamicFooter(ctx.getSystemPrompt())`, and `getAppendSystemPrompt: () => [BTW_SYSTEM_PROMPT]`. This inherits the main session's system prompt (so the sub-agent knows the project) without loading extensions recursively.

**BTW system prompt** (adapted from dbachelder + read-only framing): aside conversation, main-session messages (if present) are context only, tangent mode relies on the user's words alone; plus: "You have read-only tools (read, grep, find, ls). You may inspect the codebase to answer, but you cannot run commands or modify files — never promise to make changes."

**Seeding**: `buildSeedMessages` — contextual mode pulls main messages via `buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()).messages`, filters out visible `btw-note` custom messages, and drops a trailing in-progress assistant message (`stopReason === null`, linioi's `stripInProgressMessage`) so a fork mid-stream never sees a truncated response. Tangent mode: no main messages. If `pendingThread` is non-empty, append the continuation marker pair ("[The following is a separate side conversation. Continue this thread.]" / "Understood, continuing our side conversation.") followed by each Q/A as user/assistant messages with zeroed usage. Assign to `session.agent.state.messages` before the first prompt (dbachelder).

**Streaming into the widget**: `session.subscribe(handler)` maps `AgentSessionEvent`s onto the active slot — `message_update`/`message_end` (assistant) update `slot.thinking`/`slot.answer` from the message's `thinking`/`text` parts; `tool_execution_start` sets `slot.toolLine = "⚙ <toolName> <argsPreview>"`; `tool_execution_end` clears it; then re-render the widget. Unsubscribe on dispose.

**Run flow** (`runBtw`): resolve settings → verify credentials → `ensureSession` → push streaming slot → `await session.prompt(question, { source: "extension" })` → read the final assistant message from `session.state.messages`; `stopReason === "aborted"` → drop the slot, status "aborted"; `"error"` → error path; else finalize slot, push `BtwDetails` to `pendingThread`, `pi.appendEntry("btw-exchange", details)`, handle `--save`.

**Abort-safety** (linioi requirement): the sub-session owns its own abort lifecycle — cancelling BTW is `session.abort()` on the *sub*-session only, and nothing in the BTW path ever calls abort on the main agent or shares its signal. Conversely the main turn finishing/aborting never touches the BTW sub-session.

## Handoff

`/btw:inject` and `/btw:summarize` build content from `pendingThread` (not from the live sub-session transcript — simpler than dbachelder and sufficient since every completed exchange lands in `pendingThread`), deliver via `pi.sendUserMessage(..., ctx.isIdle() ? undefined : { deliverAs: "followUp" })`, then reset. `deliverAs: "followUp"` is documented in extensions.md § pi.sendUserMessage ("Waits for agent to finish all tools").

## Main-context hygiene

- Hidden thread: `pi.appendEntry` entries "do NOT participate in LLM context" (extensions.md § pi.appendEntry) — no filtering needed.
- `--save` notes: `pi.sendMessage({customType: "btw-note", content: "Q: …\
\
A: …", display: true, details})` **does** participate in context, so register `pi.on("context", e => ({ messages: e.messages.filter(m => m.customType !== "btw-note") }))` and a `pi.registerMessageRenderer("btw-note", …)` for display (dbachelder pattern). Save while main agent busy → `pi.sendMessage(msg, { deliverAs: "followUp" })` ("queued" notify).

# Persistence schema

All state that must survive `/reload` is written with `pi.appendEntry(customType, data)` and replayed in order from `ctx.sessionManager.getBranch()` on `session_start` **and** `session_tree` (branch switches change which entries are on the branch).

| customType | data | semantics |
|---|---|---|
| `btw-exchange` | `{question, thinking, answer, provider, model, api, thinkingLevel, timestamp, usage?}` | one completed exchange |
| `btw-reset` | `{timestamp, mode: "contextual" \| "tangent"}` | thread boundary; sets current mode |
| `btw-model-override` | `{timestamp, action: "set", provider, id, api}` or `{timestamp, action: "clear"}` | replayed cumulatively |
| `btw-thinking-override` | `{timestamp, action: "set", thinkingLevel}` or `{timestamp, action: "clear"}` | replayed cumulatively |

Replay (`replayBranch`, pure): walk the whole branch applying override entries in order (a `set` whose model no longer resolves in `ctx.modelRegistry.find` is dropped with a warning); track the index of the last `btw-reset` (which also fixes `mode`); collect `btw-exchange` entries **after** it (skipping malformed/error entries) into `pendingThread` and completed slots. On restore with slots present, re-render the widget. `session_shutdown` → dispose sub-session, clear widget (extensions.md lifecycle: cleanup in `session_shutdown`, re-establish in `session_start`).

# Widget rendering spec

Rendered with `ctx.ui.setWidget("btw", (tui, theme) => new Text(buildWidgetLines(state, theme).join("\
"), 0, 0), { placement: "aboveEditor" })`; cleared with `ctx.ui.setWidget("btw", undefined)` (extensions.md § Widgets, Status, and Footer). `buildWidgetLines` is pure (takes a minimal `ThemeLike` with `fg`/`italic`) for testability.

```
╭ 💭 btw ────────────────────── /btw:clear to dismiss ╮     ← title + hint in border; "💭 btw (tangent)" in tangent mode
│ 3 exchanges · claude-haiku (override) · thinking low      ← header only when >0 exchanges or override active
│ ───                                                       ← divider between slots
│ › how does catalog refresh work?                          ← question (accent "› ")
│ ⚙ grep "catalog" …                                        ← transient tool line while a tool runs
│ thinking text in dim italic ▍                             ← streaming cursor ▍ (warning color) on the active tail
│ It fetches catalog.json from the remote main branch…      ← answer; first line prefixed "│ ", rest raw (TUI wraps)
│ ⏳ thinking...                                             ← placeholder before any delta arrives
│ ⏳ summarizing...                                          ← transient status line (widgetStatus)
╰──────────────────────────────────────────────────────╯
```

Rules: border width fixed at 54 columns (noahsaso's proportions); at most the **last 3** exchanges are rendered in full — older ones are represented only by the header count; the streaming slot is always shown; error slots render the message with `✗` in error color; the `▍` cursor appears on thinking while no answer text exists yet, else on the answer tail, and disappears when `done`. Empty `slots` → widget cleared entirely.

# Degrade & error paths

- **No UI (`ctx.hasUI === false`, print/JSON mode)**: every `ctx.ui.*` call is guarded by a `notify(ctx, msg, level)` / `renderWidget(ctx)` helper that checks `ctx.hasUI` first — commands never crash; they simply produce no UI. (extensions.md § ctx.hasUI.)
- **RPC/GUI mode**: `hasUI` is `true`; `notify` and `setWidget` are documented as working in both TUI and RPC modes (extensions.md § ctx.hasUI), so BTW degrades to notifications plus whatever the GUI does with widget data. No `ui.custom()` overlays are used anywhere — that is the modal path we deliberately avoided.
- **No model / no credentials**: error notify before creating a session; nothing mutated.
- **Override model missing credentials**: warn + fall back to main model for that request; override stays configured.
- **Override model gone from registry on restore**: dropped with a warning.
- **Model/tool/stream error mid-answer**: slot marked `✗ <message>`, error exchange is *not* pushed to `pendingThread` and *not* persisted; sub-session disposed (next question rebuilds from `pendingThread`).
- **Abort** (`/btw:clear` mid-stream or shutdown): `session.abort()` in try/catch, then `dispose()`; partial slot removed; **never** touches the main turn.
- **Inject/summarize failure**: thread and widget preserved for retry; error notify.
- **Main agent busy**: `--save` note and inject/summarize content delivered as `followUp`; asking questions works concurrently with a streaming main turn (that is the whole point).

# package.json

```json
{
  "name": "@pify/btw",
  "version": "0.1.0",
  "description": "By-the-way side conversations for pi: a read-only, codebase-aware side agent in a widget, without derailing the main session",
  "keywords": ["pi-package", "pi-extension", "pi", "pify", "btw"],
  "homepage": "https://github.com/pifydev/btw#readme",
  "bugs": { "url": "https://github.com/pifydev/btw/issues" },
  "repository": { "type": "git", "url": "git+https://github.com/pifydev/btw.git" },
  "license": "MIT",
  "author": "Pify maintainers",
  "type": "module",
  "engines": { "node": ">=22.19.0" },
  "files": ["extensions", "src", "skills", "README.md", "LICENSE"],
  "pi": {
    "extensions": ["./extensions/btw.ts"],
    "skills": ["./skills"]
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "node --test test/*.test.ts",
    "prepublishOnly": "npm run typecheck && npm test"
  },
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  },
  "peerDependenciesMeta": {
    "@earendil-works/pi-ai": { "optional": true },
    "@earendil-works/pi-coding-agent": { "optional": true },
    "@earendil-works/pi-tui": { "optional": true }
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "typescript": "^5.7.2"
  },
  "publishConfig": { "access": "public" }
}
```

Notes: only the three peers we actually import are listed (`pi-ai` type-only; `pi-coding-agent` for `createAgentSession` etc.; `pi-tui` for `Text` in the widget factory) — `typebox` and `pi-agent-core` are not imported, per packages.md ("If you import any of these, list them in peerDependencies with a `*` range and do not bundle them"). `optional: true` stops npm from installing them when pi runs `npm install` on the package — the host provides them. `files` must include `src/` because the raw-TS entry imports it.

# Test plan

`node --test test/*.test.ts` on Node >= 22.19 runs raw TS via built-in type stripping (default since 22.18) — **zero test framework, zero runtime devDeps**. To make this possible, `src/` uses only local structural types from `src/types.ts` (no value or type imports from peer packages); only `extensions/btw.ts` imports peers, and it is excluded from the test surface.

Unit-testable without a pi host (pure modules):
- `args.test.ts` — `--save`/`-s` extraction, model arg arity/`clear`/`show`, thinking level validation.
- `handoff.test.ts` — `formatThread` exchange formatting, inject/summary content with and without instructions, `<btw-thread>`/`<btw-summary>` wrapping.
- `persistence.test.ts` — `replayBranch` over synthetic entry arrays: reset boundaries, mode tracking, cumulative override set/clear, malformed-entry skipping, exchanges-after-last-reset selection.
- `seed.test.ts` — continuation-marker pair emitted only when thread non-empty; tangent mode excludes main messages; in-progress assistant message stripped; btw-note messages filtered.
- `widget.test.ts` — `buildWidgetLines` with a fake theme: border/hint, tangent title, 3-exchange cap + header count, cursor placement, error slot, empty state.

Not testable without a live host, covered by a **smoke script** instead (`test/smoke.md` checklist run with `pi -e /d/project/pify-plugins/btw`): sub-session creation/streaming, read-only tool enforcement (ask it to edit a file — it must refuse for lack of tools), widget rendering in a real TUI, `--save` note rendering + context filtering, `/reload` rehydration, inject/summarize delivery to a busy main agent, RPC-mode degrade. Justification: `createAgentSession` needs real model credentials and a full runtime; mocking `ExtensionAPI`/`AgentSession` faithfully would exceed the value of the tests (dbachelder's vitest suite does mock the host, at ~2300 lines of harness — not worth it for v0.1).

`tsc --noEmit` covers `src/` + `test/` strictly with only `typescript`/`@types/node`. `extensions/btw.ts` is typechecked in the dev environment where pi is installed (a second `tsconfig.ext.json` with `paths` pointing at the global pi install); acceptable trade-off to keep devDeps at two.

# Open risks

1. **Erasable-syntax constraint**: Node type stripping forbids enums/namespaces/parameter properties in `src/` and `test/`; jiti (host side) doesn't care. Enforced by `tsc` with `erasableSyntaxOnly` if the pinned TS version supports it.
2. **`ThinkingLevel` union drift**: the `off|minimal|low|medium|high` set must be verified against `@earendil-works/pi-ai` 0.84.x at implementation time.
3. **Widget growth**: even capped at 3 exchanges, long answers make the above-editor widget tall. v0.1 accepts this (noahsaso did); if it hurts, v0.2 can truncate answers with a "see /btw:inject" tail.
4. **One in-flight question**: no concurrent slots (noahsaso allowed them; we serialize on the shared sub-session). Revisit if users miss it.
5. **`session.agent.state.messages` seeding** is the one API touch not covered by sdk.md prose (proven in dbachelder 0.4.1 against pi >= 0.74). Verify against 0.84.4 during smoke testing; fallback is prepending the thread as text in the first prompt.
6. **peerDependenciesMeta optional** behavior under pi's `npm install` should be confirmed once on a clean install (`pi install npm:@pify/btw`).
7. **After publish**: flip `btw` to `status: "published"` in `D:\project\pify-plugins\cli\catalog.json` (pifydev/cli), per project convention. Git identity: `hypnguyen1209 <hypnguyen1209@gmail.com>`, no Co-Authored-By.

---


