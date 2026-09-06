/**
 * A stub pi host, enough to drive the extension's own logic in a test.
 *
 * The parts this replaces are the parts a checklist item like "/btw:clear
 * dismisses the widget" is actually about: which command ran, what it wrote
 * to the session, and what it handed to setWidget. What it does NOT replace
 * is the terminal — the widget is captured as the lines the extension asked
 * for, not as pixels — or the model, which only the live script exercises.
 */

export interface UiCall {
  method: "setWidget" | "notify" | "setStatus";
  key?: string;
  lines?: string[] | null;
  message?: string;
  level?: string;
}

export interface Entry {
  type: "custom";
  customType: string;
  data: unknown;
}

export interface SentMessage {
  customType: string;
  content: string;
  display?: boolean;
  options?: unknown;
}

export interface StubModel {
  id: string;
  provider: string;
  contextWindow?: number;
}

export interface StubOptions {
  cwd?: string;
  model?: StubModel | null;
  /** Models the registry knows about, by "provider/id". */
  registry?: Record<string, StubModel>;
  /** Registry keys that have usable credentials. */
  credentialed?: string[];
  hasUI?: boolean;
  thinkingLevel?: string;
  /** ExtensionContext.mode in the real host: tui | rpc | json | print. */
  mode?: "tui" | "rpc" | "json" | "print";
  /** isIdle() is a method on the real context, and deliver() branches on it. */
  idle?: boolean;
}

export class StubHost {
  readonly commands = new Map<string, (args: string, ctx: unknown) => Promise<void> | void>();
  readonly handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void> | void>();
  readonly entries: Entry[] = [];
  readonly ui: UiCall[] = [];
  readonly sent: SentMessage[] = [];
  readonly userMessages: string[] = [];
  readonly userMessageOptions: unknown[] = [];
  thinkingLevel: string;

  private readonly opts: Required<Pick<StubOptions, "cwd" | "hasUI">> & StubOptions;

  constructor(opts: StubOptions = {}) {
    this.opts = { cwd: opts.cwd ?? "/repo", hasUI: opts.hasUI ?? true, ...opts };
    this.thinkingLevel = opts.thinkingLevel ?? "medium";
  }

  /** The `pi` object handed to the extension factory. */
  get api(): Record<string, unknown> {
    return {
      registerCommand: (name: string, spec: { handler: (args: string, ctx: unknown) => Promise<void> | void }) => {
        this.commands.set(name, spec.handler);
      },
      registerTool: () => {},
      registerShortcut: () => {},
      registerFlag: () => {},
      getFlag: () => false,
      on: (event: string, handler: (e: unknown, c: unknown) => Promise<void> | void) => {
        this.handlers.set(event, handler);
      },
      appendEntry: (customType: string, data: unknown) => {
        this.entries.push({ type: "custom", customType, data });
      },
      sendMessage: (message: SentMessage, options?: unknown) => {
        this.sent.push({ ...message, options });
      },
      sendUserMessage: (text: string, options?: unknown) => {
        this.userMessages.push(text);
        this.userMessageOptions.push(options);
      },
      getThinkingLevel: () => this.thinkingLevel,
      setThinkingLevel: (level: string) => {
        this.thinkingLevel = level;
      },
    };
  }

  /** The context handed to command handlers and event hooks. */
  get ctx(): Record<string, unknown> {
    const registry = this.opts.registry ?? {};
    const credentialed = new Set(this.opts.credentialed ?? Object.keys(registry));
    return {
      // Shape follows packages/coding-agent/src/core/extensions/types.ts in
      // the pi source: every member the extension touches is here with the
      // real arity, so a stub cannot pass what the host would reject.
      cwd: this.opts.cwd,
      hasUI: this.opts.hasUI,
      mode: this.opts.mode ?? "tui",
      isIdle: () => this.opts.idle ?? true,
      isProjectTrusted: () => true,
      hasPendingMessages: () => false,
      signal: undefined,
      abort: () => {},
      shutdown: () => {},
      compact: () => {},
      getContextUsage: () => undefined,
      getSystemPrompt: () => "",
      scopedModels: [],
      thinkingLevel: this.thinkingLevel,
      waitForIdle: async () => {},
      model: this.opts.model ?? { id: "gpt-5.5", provider: "openai" },
      modelRegistry: {
        find: (provider: string, id: string) => registry[`${provider}/${id}`],
        getApiKeyAndHeaders: async (model: StubModel) =>
          credentialed.has(`${model.provider}/${model.id}`)
            ? { ok: true as const, apiKey: "k" }
            : { ok: false as const },
      },
      sessionManager: {
        getBranch: () => this.entries,
        getEntries: () => this.entries,
        getLeafId: () => null,
      },
      getSystemPromptOptions: () => ({}),
      ui: {
        setWidget: (key: string, content: unknown) => {
          // The real signature takes string[] | render function | undefined.
          this.ui.push({
            method: "setWidget",
            key,
            lines: content === undefined ? null : Array.isArray(content) ? content : renderLines(content),
          });
        },
        notify: (message: string, level: string) => {
          this.ui.push({ method: "notify", message, level });
        },
        setStatus: (key: string, text: string | undefined) => {
          this.ui.push({ method: "setStatus", key, message: text });
        },
      },
    };
  }

  async run(command: string, args = ""): Promise<void> {
    const handler = this.commands.get(command);
    if (!handler) throw new Error(`No command /${command} registered. Have: ${[...this.commands.keys()].join(", ")}`);
    await handler(args, this.ctx);
  }

  async fire(event: string, payload: unknown = {}): Promise<void> {
    const handler = this.handlers.get(event);
    if (!handler) throw new Error(`No handler for ${event}`);
    await handler(payload, this.ctx);
  }

  /** Latest lines passed to setWidget for a key; null when it was cleared. */
  widget(key: string): string[] | null {
    for (let i = this.ui.length - 1; i >= 0; i--) {
      const call = this.ui[i]!;
      if (call.method === "setWidget" && call.key === key) return call.lines ?? null;
    }
    return null;
  }

  widgetText(key: string): string {
    return (this.widget(key) ?? []).join("\n");
  }

  widgetRenders(key: string): number {
    return this.ui.filter((c) => c.method === "setWidget" && c.key === key).length;
  }

  notifications(): string[] {
    return this.ui.filter((c) => c.method === "notify").map((c) => c.message ?? "");
  }

  entriesOf(customType: string): unknown[] {
    return this.entries.filter((e) => e.customType === customType).map((e) => e.data);
  }
}

/**
 * The extension hands setWidget a render function that builds pi's Text
 * component; call it with a no-op theme and read the string back out.
 */
function renderLines(render: unknown): string[] {
  if (typeof render !== "function") return [];
  const theme = {
    fg: (_c: string, s: string) => s,
    bold: (s: string) => s,
    italic: (s: string) => s,
    dim: (s: string) => s,
  };
  const text = (render as (tui: unknown, theme: unknown) => { text?: string })(null, theme);
  const value = typeof text === "object" && text !== null && "text" in text ? String(text.text) : String(text);
  return value.split("\n");
}
