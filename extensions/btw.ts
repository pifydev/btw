/**
 * @pify/btw — by-the-way side conversations for pi.
 *
 * /btw runs a real pi sub-session with READ-ONLY tools (read, grep, find, ls)
 * so it can answer from the codebase without ever modifying it. Answers stream
 * into a widget above the editor; the side thread stays out of the main
 * agent's LLM context and survives /reload via custom session entries.
 *
 * Design: docs/DESIGN.md. Prior art: noahsaso (widget + persistence),
 * linioi (abort-safety, in-progress stripping), williamyangcn (read-only
 * sub-agent, journal seeding), dbachelder (tangent, overrides, --save, skill).
 */
import {
  buildSessionContext,
  convertToLlm,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { parseBtwArgs, parseModelArgs, parseThinkingArgs } from "../src/args.ts";
import {
  buildInjectContent,
  buildSaveNote,
  buildSummarizePrompt,
  buildSummaryContent,
} from "../src/handoff.ts";
import {
  BTW_EXCHANGE,
  BTW_MODEL_OVERRIDE,
  BTW_NOTE,
  BTW_RESET,
  BTW_THINKING_OVERRIDE,
  replayBranch,
} from "../src/persistence.ts";
import { sanitizeAnswer } from "../src/sanitize.ts";
import { buildSeedMessages } from "../src/seed.ts";
import type {
  BtwDetails,
  BtwMode,
  BtwSlot,
  BtwThinkingLevel,
  LooseMessage,
  ModelRef,
} from "../src/types.ts";
import { buildWidgetLines } from "../src/widget.ts";

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];

const BTW_SYSTEM_PROMPT = [
  "You are having an aside conversation with the user, separate from their main working session.",
  "If main-session messages are present, they are context only — that work is being handled by another agent.",
  "Focus on answering the user's side questions, helping them think through ideas, or planning next steps.",
  "Do not act as if you need to complete or continue the main session's work.",
  "You have exactly four tools: read, grep, find and ls. There is no edit, write or bash tool in this",
  "session and you cannot obtain one. Inspect the codebase freely to answer accurately.",
  "When asked to change something, say plainly that you cannot edit files from a side conversation,",
  "then describe the change you would make — the user can hand it to the main agent with /btw:inject.",
  "Never say or imply that you have edited, created, updated or run anything, and never write tool-call",
  "syntax as text: nothing you write here touches the repository.",
].join(" ");

const BTW_SUMMARIZE_SYSTEM_PROMPT =
  "You summarize side conversations. Output only the summary, no preamble.";

type UiContext = ExtensionContext | ExtensionCommandContext;

interface ActiveSession {
  session: AgentSession;
  mode: BtwMode;
  modelKey: string;
  thinkingLevel: BtwThinkingLevel;
  unsubscribe: () => void;
}

export default function btw(pi: ExtensionAPI) {
  // ── State (see docs/DESIGN.md § State model) ─────────────────────────
  let pendingThread: BtwDetails[] = [];
  let mode: BtwMode = "contextual";
  let modelOverride: ModelRef | null = null;
  let thinkingOverride: BtwThinkingLevel | null = null;
  let slots: BtwSlot[] = [];
  let widgetStatus: string | null = null;
  let active: ActiveSession | null = null;
  let inFlight = false;
  let lastUiCtx: UiContext | null = null;

  // ── UI helpers (guarded so print/JSON modes never crash) ─────────────

  function notify(ctx: UiContext, message: string, level: "info" | "warning" | "error"): void {
    if (ctx.hasUI) ctx.ui.notify(message, level);
  }

  function renderWidget(ctx: UiContext | null = lastUiCtx): void {
    if (!ctx || !ctx.hasUI) return;
    lastUiCtx = ctx;
    if (slots.length === 0 && !widgetStatus) {
      ctx.ui.setWidget("btw", undefined);
      return;
    }
    const state = {
      slots,
      mode,
      status: widgetStatus,
      modelLabel: modelOverride ? `${modelOverride.provider}/${modelOverride.id}` : null,
      modelOverridden: modelOverride !== null,
      thinkingLabel: thinkingOverride,
    };
    ctx.ui.setWidget(
      "btw",
      (_tui: unknown, theme: { fg(c: string, s: string): string; italic(s: string): string }) =>
        new Text(buildWidgetLines(state, theme).join("\n"), 0, 0),
      { placement: "aboveEditor" },
    );
  }

  // ── Sub-session lifecycle ────────────────────────────────────────────

  function makeResourceLoader(ctx: ExtensionCommandContext, extraAppend: string[] = []) {
    const promptOptions = ctx.getSystemPromptOptions();
    return new DefaultResourceLoader({
      cwd: ctx.cwd,
      agentDir: getAgentDir(),
      // Never load extensions recursively (a btw inside a btw); keep the
      // rest of the project surface (context files, skills) available.
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: promptOptions.customPrompt,
      appendSystemPrompt: [
        ...(promptOptions.appendSystemPrompt ? [promptOptions.appendSystemPrompt] : []),
        BTW_SYSTEM_PROMPT,
        ...extraAppend,
      ],
    });
  }

  interface ResolvedSettings {
    model: NonNullable<ExtensionCommandContext["model"]>;
    thinkingLevel: BtwThinkingLevel;
    overrideFellBack: string | null;
  }

  /** Resolve the effective btw model+thinking, falling back when the override is unusable. */
  async function resolveSettings(ctx: ExtensionCommandContext): Promise<ResolvedSettings | null> {
    let model = ctx.model ?? null;
    let overrideFellBack: string | null = null;

    if (modelOverride) {
      const found = ctx.modelRegistry.find(modelOverride.provider, modelOverride.id);
      if (!found) {
        overrideFellBack = `override ${modelOverride.provider}/${modelOverride.id} not found in registry`;
      } else {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(found);
        if (auth.ok) {
          model = found;
        } else {
          overrideFellBack = `override ${modelOverride.provider}/${modelOverride.id} has no credentials`;
        }
      }
    }

    if (!model) return null;
    const thinkingLevel = thinkingOverride ?? (pi.getThinkingLevel() as BtwThinkingLevel);
    return { model, thinkingLevel, overrideFellBack };
  }

  function disposeSession(): void {
    if (!active) return;
    const current = active;
    active = null;
    try {
      current.unsubscribe();
    } catch {
      // already gone
    }
    void (async () => {
      try {
        await current.session.abort();
      } catch {
        // aborting an idle session is fine to fail
      }
      try {
        current.session.dispose();
      } catch {
        // double-dispose is fine
      }
    })();
  }

  function handleSessionEvent(event: AgentSessionEvent): void {
    const slot = slots[slots.length - 1];
    if (!slot || slot.done) return;

    if (event.type === "message_update" && event.message.role === "assistant") {
      const content = (event.message as { content?: unknown }).content;
      if (Array.isArray(content)) {
        let thinking = "";
        let answer = "";
        for (const part of content as Array<{ type?: string; text?: string; thinking?: string }>) {
          if (part.type === "thinking" && typeof part.thinking === "string") {
            thinking += part.thinking;
          } else if (part.type === "text" && typeof part.text === "string") {
            answer += part.text;
          }
        }
        slot.thinking = thinking.trim();
        slot.answer = answer;
      }
      renderWidget();
    } else if (event.type === "tool_execution_start") {
      const argsPreview = JSON.stringify(event.args ?? {}).slice(0, 40);
      slot.toolLine = `${event.toolName} ${argsPreview}`;
      renderWidget();
    } else if (event.type === "tool_execution_end") {
      slot.toolLine = null;
      renderWidget();
    }
  }

  async function ensureSession(
    ctx: ExtensionCommandContext,
    settings: ResolvedSettings,
  ): Promise<AgentSession> {
    const modelKey = `${settings.model.provider}/${settings.model.id}`;
    if (
      active &&
      active.mode === mode &&
      active.modelKey === modelKey &&
      active.thinkingLevel === settings.thinkingLevel
    ) {
      return active.session;
    }
    disposeSession();

    // Seed the JOURNAL, not agent state: createAgentSession restores messages
    // from a non-empty session manager itself, and compaction rebuilds re-read
    // the journal — a state-only seed would be silently dropped on the first
    // compaction (williamyangcn).
    const sessionManager = SessionManager.inMemory(ctx.cwd);
    const mainMessages =
      mode === "contextual"
        ? (convertToLlm(
            buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId())
              .messages,
          ) as unknown as LooseMessage[])
        : [];
    const seed = buildSeedMessages(mainMessages, pendingThread, mode, {
      id: settings.model.id,
      provider: settings.model.provider,
    });
    for (const message of seed) {
      sessionManager.appendMessage(
        message as unknown as Parameters<typeof sessionManager.appendMessage>[0],
      );
    }

    // No modelRuntime option: createAgentSession builds the default runtime
    // from agentDir (same auth.json/models.json the host uses) — the
    // ModelRegistry facade exposed to extensions cannot hand its runtime over.
    const { session } = await createAgentSession({
      sessionManager,
      model: settings.model,
      thinkingLevel: settings.thinkingLevel as never,
      tools: READ_ONLY_TOOLS,
      resourceLoader: makeResourceLoader(ctx),
    });

    const unsubscribe = session.subscribe(handleSessionEvent);
    active = {
      session,
      mode,
      modelKey,
      thinkingLevel: settings.thinkingLevel,
      unsubscribe,
    };
    return session;
  }

  // ── Thread lifecycle ─────────────────────────────────────────────────

  function resetThread(ctx: UiContext, nextMode: BtwMode): void {
    disposeSession();
    pendingThread = [];
    slots = [];
    widgetStatus = null;
    mode = nextMode;
    pi.appendEntry(BTW_RESET, { timestamp: Date.now(), mode: nextMode });
    renderWidget(ctx);
  }

  function contentText(session: AgentSession): { answer: string; thinking: string; stopReason: unknown } {
    const messages = session.messages as Array<{
      role?: string;
      stopReason?: unknown;
      content?: Array<{ type?: string; text?: string; thinking?: string }>;
    }>;
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (!last) return { answer: "", thinking: "", stopReason: undefined };
    let answer = "";
    let thinking = "";
    for (const part of last.content ?? []) {
      if (part.type === "text" && typeof part.text === "string") answer += part.text;
      if (part.type === "thinking" && typeof part.thinking === "string") thinking += part.thinking;
    }
    return {
      answer: sanitizeAnswer(answer),
      thinking: thinking.trim(),
      stopReason: last.stopReason,
    };
  }

  async function runBtw(
    ctx: ExtensionCommandContext,
    question: string,
    save: boolean,
    askMode: BtwMode,
  ): Promise<void> {
    if (inFlight) {
      notify(ctx, "BTW is busy — wait for the current answer or /btw:clear", "warning");
      return;
    }
    if (mode !== askMode) {
      // Switching between contextual and tangent clears the thread (dbachelder).
      resetThread(ctx, askMode);
    }

    const settings = await resolveSettings(ctx);
    if (!settings) {
      notify(ctx, "No model selected", "error");
      return;
    }
    if (settings.overrideFellBack) {
      notify(ctx, `btw: ${settings.overrideFellBack} — using the main model`, "warning");
    }

    const slot: BtwSlot = { question, thinking: "", answer: "", toolLine: null, done: false };
    slots.push(slot);
    renderWidget(ctx);
    inFlight = true;

    try {
      const session = await ensureSession(ctx, settings);
      await session.prompt(question, { source: "extension" } as never);

      const result = contentText(session);
      if (result.stopReason === "aborted") {
        slots.pop();
        renderWidget(ctx);
        return;
      }
      if (result.stopReason === "error" || (!result.answer && !result.thinking)) {
        slot.error = result.answer || "Model request failed";
        slot.done = true;
        renderWidget(ctx);
        disposeSession();
        return;
      }

      slot.thinking = result.thinking;
      slot.answer = result.answer;
      slot.done = true;
      renderWidget(ctx);

      const details: BtwDetails = {
        question,
        thinking: result.thinking,
        answer: result.answer,
        provider: settings.model.provider,
        model: settings.model.id,
        api: String(settings.model.api ?? ""),
        thinkingLevel: settings.thinkingLevel,
        timestamp: Date.now(),
      };
      pendingThread.push(details);
      pi.appendEntry(BTW_EXCHANGE, details);

      if (save) {
        const options = ctx.isIdle() ? undefined : ({ deliverAs: "followUp" } as const);
        pi.sendMessage(
          { customType: BTW_NOTE, content: buildSaveNote(details), display: true, details },
          options,
        );
        notify(ctx, ctx.isIdle() ? "btw: note saved to session" : "btw: note queued", "info");
      }
    } catch (err) {
      slot.error = err instanceof Error ? err.message : String(err);
      slot.done = true;
      renderWidget(ctx);
      disposeSession();
    } finally {
      inFlight = false;
    }
  }

  // ── Handoff ──────────────────────────────────────────────────────────

  function deliver(ctx: ExtensionCommandContext, content: string): void {
    pi.sendUserMessage(content, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
  }

  // ── Session lifecycle events ─────────────────────────────────────────

  function restore(ctx: ExtensionContext): void {
    const restored = replayBranch(ctx.sessionManager.getBranch() as never);
    pendingThread = restored.thread;
    mode = restored.mode;
    thinkingOverride = restored.thinkingOverride;
    modelOverride = restored.modelOverride;
    if (modelOverride && !ctx.modelRegistry.find(modelOverride.provider, modelOverride.id)) {
      notify(
        ctx,
        `btw: saved model override ${modelOverride.provider}/${modelOverride.id} is gone — cleared`,
        "warning",
      );
      modelOverride = null;
    }
    slots = pendingThread.map((d) => ({
      question: d.question,
      thinking: d.thinking,
      answer: d.answer,
      toolLine: null,
      done: true,
    }));
    widgetStatus = null;
    renderWidget(ctx);
  }

  pi.on("session_start", async (_event, ctx) => {
    disposeSession();
    restore(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    // Branch switches change which entries are on the active branch.
    disposeSession();
    restore(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    // Idempotent: fires on quit, /reload, /new, /resume, and /fork.
    disposeSession();
    if (ctx.hasUI) ctx.ui.setWidget("btw", undefined);
  });

  // Visible --save notes must never re-enter the main agent's context.
  pi.on("context", async (event) => {
    const messages = event.messages.filter(
      (m) => (m as { customType?: string }).customType !== BTW_NOTE,
    );
    return messages.length === event.messages.length ? undefined : { messages };
  });

  // ── Commands ─────────────────────────────────────────────────────────

  pi.registerCommand("btw", {
    description: "Ask a read-only side agent (works while the main agent is busy). [--save]",
    handler: async (args, ctx) => {
      const { save, question } = parseBtwArgs(args ?? "");
      if (!question) {
        notify(ctx, "Usage: /btw [--save] <question>", "warning");
        renderWidget(ctx);
        return;
      }
      await runBtw(ctx, question, save, "contextual");
    },
  });

  pi.registerCommand("btw:new", {
    description: "Start a fresh BTW thread, optionally with a first question",
    handler: async (args, ctx) => {
      resetThread(ctx, "contextual");
      const { save, question } = parseBtwArgs(args ?? "");
      if (question) {
        await runBtw(ctx, question, save, "contextual");
      } else {
        notify(ctx, "btw: started a fresh thread", "info");
      }
    },
  });

  pi.registerCommand("btw:tangent", {
    description: "Contextless side thread (no main-session context). [--save]",
    handler: async (args, ctx) => {
      const { save, question } = parseBtwArgs(args ?? "");
      if (!question) {
        notify(ctx, "Usage: /btw:tangent [--save] <question>", "warning");
        return;
      }
      await runBtw(ctx, question, save, "tangent");
    },
  });

  pi.registerCommand("btw:clear", {
    description: "Dismiss the BTW widget and clear the thread",
    handler: async (_args, ctx) => {
      resetThread(ctx, "contextual");
    },
  });

  pi.registerCommand("btw:inject", {
    description: "Inject the BTW thread into the main agent [optional instructions]",
    handler: async (args, ctx) => {
      if (pendingThread.length === 0) {
        notify(ctx, "No active BTW thread to inject", "warning");
        return;
      }
      const count = pendingThread.length;
      try {
        deliver(ctx, buildInjectContent(pendingThread, (args ?? "").trim()));
      } catch (err) {
        notify(ctx, `btw:inject failed — ${err instanceof Error ? err.message : String(err)}`, "error");
        return;
      }
      resetThread(ctx, "contextual");
      notify(ctx, `btw → main: injected ${count} exchange${count > 1 ? "s" : ""}`, "info");
    },
  });

  pi.registerCommand("btw:summarize", {
    description: "Summarize the BTW thread and inject it [optional instructions]",
    handler: async (args, ctx) => {
      if (pendingThread.length === 0) {
        notify(ctx, "No active BTW thread to summarize", "warning");
        return;
      }
      const settings = await resolveSettings(ctx);
      if (!settings) {
        notify(ctx, "No model selected", "error");
        return;
      }

      widgetStatus = "⏳ summarizing...";
      renderWidget(ctx);

      // One-off summarizer sub-session: no tools, thinking off.
      let summarizer: AgentSession | null = null;
      try {
        const created = await createAgentSession({
          sessionManager: SessionManager.inMemory(ctx.cwd),
          model: settings.model,
          thinkingLevel: "off" as never,
          tools: [],
          resourceLoader: makeResourceLoader(ctx, [BTW_SUMMARIZE_SYSTEM_PROMPT]),
        });
        summarizer = created.session;
        await summarizer.prompt(buildSummarizePrompt(pendingThread), {
          source: "extension",
        } as never);
        const result = contentText(summarizer);
        if (!result.answer || result.stopReason === "error" || result.stopReason === "aborted") {
          throw new Error(result.answer || "summarizer returned no text");
        }

        const count = pendingThread.length;
        deliver(ctx, buildSummaryContent(result.answer, (args ?? "").trim()));
        resetThread(ctx, "contextual");
        notify(ctx, `btw → main: injected summary of ${count} exchange${count > 1 ? "s" : ""}`, "info");
      } catch (err) {
        widgetStatus = null;
        renderWidget(ctx);
        notify(ctx, `btw:summarize error — ${err instanceof Error ? err.message : String(err)}`, "error");
      } finally {
        if (summarizer) {
          try {
            await summarizer.abort();
          } catch {
            // idle abort may fail; ignore
          }
          try {
            summarizer.dispose();
          } catch {
            // double-dispose is fine
          }
        }
      }
    },
  });

  pi.registerCommand("btw:model", {
    description: "Show or set a BTW-only model override [<provider> <model> <api> | clear]",
    handler: async (args, ctx) => {
      const cmd = parseModelArgs(args ?? "");
      switch (cmd.kind) {
        case "show": {
          const settings = await resolveSettings(ctx);
          const effective = settings ? `${settings.model.provider}/${settings.model.id}` : "none";
          const source = modelOverride
            ? settings?.overrideFellBack
              ? `override set but falling back (${settings.overrideFellBack})`
              : "override"
            : "inherits main thread";
          notify(ctx, `btw model: ${effective} (${source})`, "info");
          return;
        }
        case "clear": {
          modelOverride = null;
          pi.appendEntry(BTW_MODEL_OVERRIDE, { timestamp: Date.now(), action: "clear" });
          disposeSession(); // next question rebuilds with inherited settings
          notify(ctx, "btw model: override cleared (inherits main thread)", "info");
          renderWidget(ctx);
          return;
        }
        case "set": {
          const found = ctx.modelRegistry.find(cmd.ref.provider, cmd.ref.id);
          if (!found) {
            notify(
              ctx,
              `Unknown model ${cmd.ref.provider}/${cmd.ref.id} — check /models or log in first`,
              "error",
            );
            return;
          }
          modelOverride = cmd.ref;
          pi.appendEntry(BTW_MODEL_OVERRIDE, {
            timestamp: Date.now(),
            action: "set",
            ...cmd.ref,
          });
          // Dispose but keep pendingThread: the next question reseeds a fresh
          // sub-session from the preserved hidden thread (dbachelder).
          disposeSession();
          notify(ctx, `btw model: ${cmd.ref.provider}/${cmd.ref.id} (override)`, "info");
          renderWidget(ctx);
          return;
        }
        case "error":
          notify(ctx, cmd.message, "warning");
      }
    },
  });

  pi.registerCommand("btw:thinking", {
    description: "Show or set a BTW-only thinking override [<level> | clear]",
    handler: async (args, ctx) => {
      const cmd = parseThinkingArgs(args ?? "");
      switch (cmd.kind) {
        case "show": {
          const effective = thinkingOverride ?? pi.getThinkingLevel();
          const source = thinkingOverride ? "override" : "inherits main thread";
          notify(ctx, `btw thinking: ${effective} (${source})`, "info");
          return;
        }
        case "clear": {
          thinkingOverride = null;
          pi.appendEntry(BTW_THINKING_OVERRIDE, { timestamp: Date.now(), action: "clear" });
          disposeSession();
          notify(ctx, "btw thinking: override cleared (inherits main thread)", "info");
          renderWidget(ctx);
          return;
        }
        case "set": {
          thinkingOverride = cmd.level;
          pi.appendEntry(BTW_THINKING_OVERRIDE, {
            timestamp: Date.now(),
            action: "set",
            thinkingLevel: cmd.level,
          });
          disposeSession();
          notify(ctx, `btw thinking: ${cmd.level} (override)`, "info");
          renderWidget(ctx);
          return;
        }
        case "error":
          notify(ctx, cmd.message, "warning");
      }
    },
  });
}
