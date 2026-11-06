const __deepcode_import_meta_url = require("node:url").pathToFileURL(__filename).href;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);

// ../../packages/protocol/dist/types.js
var PROTOCOL_VERSION = 1;

// ../../packages/protocol/dist/codec.js
function encodeProtocolMessage(message) {
  return JSON.stringify(message);
}

// ../../packages/protocol/dist/client.js
var ProtocolClient = class {
  connection;
  timeoutMs;
  pending = /* @__PURE__ */ new Map();
  subscribers = /* @__PURE__ */ new Set();
  nextId = 1;
  opened = false;
  initialized;
  connecting;
  constructor(connection, timeoutMs = 3e4) {
    this.connection = connection;
    this.timeoutMs = timeoutMs;
  }
  async connect() {
    if (this.initialized)
      return this.initialized;
    if (this.connecting)
      return this.connecting;
    this.connecting = this.open();
    try {
      return await this.connecting;
    } finally {
      this.connecting = void 0;
    }
  }
  subscribe(handler) {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }
  async request(method, params = {}) {
    if (!this.opened)
      throw new Error("app-server client is not connected");
    const id = this.nextId++;
    const request = { id, method, params };
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`app-server request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value),
        reject,
        timeout
      });
    });
    try {
      await this.connection.send(encodeProtocolMessage(request));
    } catch (error) {
      this.rejectRequest(id, asError(error));
    }
    return response;
  }
  async close() {
    this.disconnect(new Error("app-server client closed"));
    await this.connection.close();
  }
  async open() {
    if (!this.opened) {
      await this.connection.open((message) => this.receive(message), (error) => this.disconnect(error));
      this.opened = true;
    }
    const initialized = await this.request("initialize");
    if (initialized.protocolVersion !== PROTOCOL_VERSION) {
      await this.close();
      throw new Error(`Unsupported app-server protocol version: ${initialized.protocolVersion}`);
    }
    this.initialized = initialized;
    return initialized;
  }
  receive(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      this.disconnect(new Error("app-server emitted invalid JSON"));
      return;
    }
    if ("method" in message) {
      if (message.method === "event") {
        for (const subscriber of this.subscribers)
          subscriber(message.params);
      }
      return;
    }
    if (typeof message.id !== "number")
      return;
    const pending = this.pending.get(message.id);
    if (!pending)
      return;
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error)
      pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
    else
      pending.resolve(message.result);
  }
  disconnect(error) {
    this.opened = false;
    this.initialized = void 0;
    this.rejectAll(error);
  }
  rejectRequest(id, error) {
    const pending = this.pending.get(id);
    if (!pending)
      return;
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  rejectAll(error) {
    for (const id of [...this.pending.keys()])
      this.rejectRequest(id, error);
  }
};
function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

// ../../packages/protocol/dist/review.js
function isReviewFindingPayload(value) {
  try {
    assertReviewFinding(value);
    return true;
  } catch {
    return false;
  }
}
function assertReviewFinding(finding) {
  if (!finding || typeof finding !== "object") {
    throw new Error("A valid review finding is required");
  }
  const candidate = finding;
  if (typeof candidate.findingId !== "string" || !/^[a-zA-Z0-9._-]{1,200}$/.test(candidate.findingId) || typeof candidate.title !== "string" || candidate.title.length === 0 || candidate.title.length > 160 || hasControlCharacter(candidate.title) || typeof candidate.body !== "string" || candidate.body.length === 0 || candidate.body.length > 4e3 || typeof candidate.path !== "string" || !safeRelativePath(candidate.path) || !Number.isInteger(candidate.startLine) || !Number.isInteger(candidate.endLine) || candidate.startLine < 1 || candidate.endLine < candidate.startLine || candidate.endLine - candidate.startLine > 200 || ![0, 1, 2, 3].includes(candidate.priority) || candidate.replacement !== void 0 && (typeof candidate.replacement !== "string" || utf8ByteLength(candidate.replacement) > 32 * 1024)) {
    throw new Error("A valid review finding is required");
  }
}
function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}
function safeRelativePath(path) {
  if (path.length === 0 || path.length > 500 || path.startsWith("/") || path.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(path) || hasControlCharacter(path)) {
    return false;
  }
  return !path.split(/[\\/]/).some((part) => part === ".." || part === "");
}
function hasControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

// ../server/dist/client.js
var import_node_events = require("node:events");
var import_node_child_process = require("node:child_process");
var import_node_url = require("node:url");
var import_node_process = __toESM(require("node:process"), 1);
var import_node_readline = require("node:readline");
var SpawnedAppServerConnection = class {
  options;
  child;
  lines;
  closing = false;
  stderr = "";
  constructor(options = {}) {
    this.options = options;
  }
  async open(onMessage, onDisconnect) {
    if (this.child)
      throw new Error("app-server connection is already open");
    this.closing = false;
    this.stderr = "";
    const args = this.options.args ?? [(0, import_node_url.fileURLToPath)(new URL("./cli.js", __deepcode_import_meta_url))];
    const child = (0, import_node_child_process.spawn)(this.options.command ?? import_node_process.default.execPath, args, {
      cwd: this.options.cwd,
      env: {
        ...import_node_process.default.env,
        ...this.options.env,
        ...this.options.home ? { DEEPCODE_HOME: this.options.home } : {}
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    this.lines = (0, import_node_readline.createInterface)({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on("line", onMessage);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-8192);
    });
    try {
      await new Promise((resolve, reject) => {
        const handleSpawn = () => {
          child.off("error", handleError);
          resolve();
        };
        const handleError = (error) => {
          child.off("spawn", handleSpawn);
          reject(error);
        };
        child.once("spawn", handleSpawn);
        child.once("error", handleError);
      });
    } catch (error) {
      this.detach();
      throw error;
    }
    child.once("error", (error) => {
      if (!this.closing)
        onDisconnect(error);
      this.detach();
    });
    child.once("exit", (code, signal) => {
      const detail = this.stderr.trim();
      if (!this.closing) {
        onDisconnect(new Error(`app-server terminated (code=${code ?? "none"}, signal=${signal ?? "none"})${detail ? `: ${detail}` : ""}`));
      }
      this.detach();
    });
  }
  async send(message) {
    const child = this.child;
    if (!child || child.stdin.destroyed)
      throw new Error("app-server connection is not open");
    if (!child.stdin.write(`${message}
`))
      await (0, import_node_events.once)(child.stdin, "drain");
  }
  async close() {
    const child = this.child;
    if (!child)
      return;
    this.closing = true;
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) {
      const grace = this.options.closeGraceMs ?? 5e3;
      const closed = (0, import_node_events.once)(child, "close").then(() => true);
      const timedOut = new Promise((resolve) => {
        setTimeout(() => resolve(false), grace).unref();
      });
      if (!await Promise.race([closed, timedOut])) {
        child.kill("SIGTERM");
        await (0, import_node_events.once)(child, "close").catch(() => void 0);
      }
    }
    this.detach();
  }
  detach() {
    this.lines?.close();
    this.lines = void 0;
    this.child = void 0;
  }
};

// src/protocol-runtime.ts
var EditorProtocolRuntime = class {
  constructor(client, cwd) {
    this.client = client;
    this.cwd = cwd;
    this.unsubscribe = client.subscribe((event) => this.route(event));
  }
  threadId;
  turnThreads = /* @__PURE__ */ new Map();
  handlers = /* @__PURE__ */ new Map();
  queued = /* @__PURE__ */ new Map();
  unsubscribe;
  async start(input, onEvent) {
    if (!input.text.trim()) throw new Error("prompt is required");
    await this.client.connect();
    const thread = await this.ensureThread(input.threadId);
    const turn = await this.client.request("turn/start", {
      threadId: thread.id,
      input: {
        text: input.text,
        ...input.model ? { model: input.model } : {},
        ...input.effort ? { effort: input.effort } : {},
        ...input.mode ? { mode: input.mode } : {}
      }
    });
    this.turnThreads.set(turn.id, thread.id);
    this.handlers.set(turn.id, onEvent);
    this.flush(turn.id);
    return { threadId: thread.id, turnId: turn.id };
  }
  async resume(threadId) {
    await this.client.connect();
    const thread = await this.client.request("thread/resume", { threadId });
    this.threadId = thread.id;
    return thread;
  }
  async read(threadId) {
    await this.client.connect();
    return this.client.request("thread/read", { threadId });
  }
  async diagnostics() {
    const initialized = await this.client.connect();
    if (!initialized.capabilities.configDiagnostics) {
      throw new Error("The app-server does not support configuration diagnostics");
    }
    return this.client.request("config/diagnostics", { cwd: this.cwd() });
  }
  async diff() {
    const initialized = await this.client.connect();
    if (!initialized.capabilities.workspaceDiff) {
      throw new Error("The app-server does not support workspace diff");
    }
    const thread = await this.ensureThread();
    return this.client.request("workspace/diff", { threadId: thread.id });
  }
  applyFinding(finding, onEvent) {
    return this.applyFindings([finding], onEvent);
  }
  async applyFindings(findings, onEvent) {
    const initialized = await this.client.connect();
    if (!initialized.capabilities.reviewActions) {
      throw new Error("The app-server does not support review actions");
    }
    const thread = await this.ensureThread();
    const turn = await this.client.request("review/apply", {
      threadId: thread.id,
      findingIds: findings.map((finding) => finding.findingId)
    });
    this.trackTurn(turn, thread.id, onEvent);
    return { threadId: thread.id, turnId: turn.id };
  }
  async revertAction(actionId, onEvent) {
    const initialized = await this.client.connect();
    if (!initialized.capabilities.reviewActions) {
      throw new Error("The app-server does not support review actions");
    }
    const thread = await this.ensureThread();
    const turn = await this.client.request("review/revert", {
      threadId: thread.id,
      actionId
    });
    this.trackTurn(turn, thread.id, onEvent);
    return { threadId: thread.id, turnId: turn.id };
  }
  async interrupt(turnId) {
    const threadId = this.turnThreads.get(turnId);
    if (!threadId) return false;
    const result = await this.client.request("turn/interrupt", {
      threadId,
      turnId
    });
    return result.interrupted;
  }
  approve(turnId, requestId, decision) {
    return this.interactionRequest("approval/respond", turnId, { requestId, decision });
  }
  answer(turnId, requestId, answer) {
    return this.interactionRequest("user-input/respond", turnId, { requestId, answer });
  }
  async close() {
    this.unsubscribe();
    this.handlers.clear();
    this.turnThreads.clear();
    this.queued.clear();
    await this.client.close();
  }
  async ensureThread(requested) {
    if (requested && requested !== this.threadId) {
      const thread2 = await this.client.request("thread/resume", {
        threadId: requested
      });
      this.threadId = thread2.id;
      return thread2;
    }
    if (this.threadId) {
      return this.client.request("thread/read", { threadId: this.threadId });
    }
    const thread = await this.client.request("thread/start", { cwd: this.cwd() });
    this.threadId = thread.id;
    return thread;
  }
  async interactionRequest(method, turnId, params) {
    const threadId = this.turnThreads.get(turnId);
    if (!threadId) throw new Error(`Active turn not found: ${turnId}`);
    return this.client.request(method, { threadId, turnId, ...params });
  }
  trackTurn(turn, threadId, onEvent) {
    this.turnThreads.set(turn.id, threadId);
    this.handlers.set(turn.id, onEvent);
    this.flush(turn.id);
  }
  route(event) {
    const turnId = turnIdFrom(event);
    if (!turnId) return;
    const handler = this.handlers.get(turnId);
    if (!handler) {
      const queued = this.queued.get(turnId) ?? [];
      queued.push(event);
      this.queued.set(turnId, queued);
      return;
    }
    this.deliver(handler, event);
  }
  flush(turnId) {
    const handler = this.handlers.get(turnId);
    if (!handler) return;
    const events = this.queued.get(turnId) ?? [];
    this.queued.delete(turnId);
    for (const event of events) this.deliver(handler, event);
  }
  deliver(handler, event) {
    handler(event);
    if (isTerminal(event)) {
      const turnId = event.turn.id;
      this.handlers.delete(turnId);
      this.turnThreads.delete(turnId);
      this.queued.delete(turnId);
    }
  }
};
function turnIdFrom(event) {
  if (event.type === "thread.started") return void 0;
  if (event.type === "turn.started" || event.type === "turn.completed" || event.type === "turn.interrupted" || event.type === "turn.failed") {
    return event.turn.id;
  }
  return event.turnId;
}
function isTerminal(event) {
  return event.type === "turn.completed" || event.type === "turn.interrupted" || event.type === "turn.failed";
}

// src/diagnostics.ts
function formatConfigDiagnostics(report) {
  const lines = [`DeepCode configuration \xB7 ${report.cwd}`, `Trust: ${report.trustStatus}`, ""];
  lines.push("Layers:");
  for (const layer of report.layers) {
    const state = layer.present ? layer.trusted ? "active" : "untrusted" : "missing";
    lines.push(`  ${layer.layer.padEnd(8)} ${state.padEnd(9)} ${layer.path}`);
  }
  lines.push("", `Gated fields: ${report.gated.length ? report.gated.join(", ") : "none"}`);
  lines.push(`Issues: ${report.issues.length}`);
  for (const issue of report.issues) {
    lines.push(`  ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
  }
  return lines;
}

// src/settings.ts
function explicitConfigValue(inspection) {
  return inspection?.workspaceFolderLanguageValue ?? inspection?.workspaceLanguageValue ?? inspection?.globalLanguageValue ?? inspection?.workspaceFolderValue ?? inspection?.workspaceValue ?? inspection?.globalValue;
}

// src/workspace-diff.ts
function formatWorkspaceDiffForReview(diff) {
  const lines = [];
  for (const file of diff.files) {
    const path = file.previousPath ? `${JSON.stringify(file.previousPath)} -> ${JSON.stringify(file.path)}` : JSON.stringify(file.path);
    lines.push(`diff -- ${file.status} ${path}`);
    if (file.binary) {
      lines.push("[binary content omitted]");
      continue;
    }
    for (const hunk of file.hunks) {
      lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
      for (const line of hunk.lines) {
        const marker = line.kind === "addition" ? "+" : line.kind === "deletion" ? "-" : " ";
        lines.push(`${marker}${line.text}`);
      }
    }
    if (file.truncated) lines.push("[file diff truncated]");
  }
  if (diff.truncated) lines.push("[workspace diff truncated]");
  return lines.join("\n");
}

// src/extension.ts
var activeRuntime;
var latestReviewFindings = /* @__PURE__ */ new Map();
var latestAppliedActionId;
async function activate(context) {
  const vscodeMod = await loadVscode();
  const { commands, window, workspace } = vscodeMod;
  const appServer = context.asAbsolutePath("dist/app-server.cjs");
  const runtime = new EditorProtocolRuntime(
    new ProtocolClient(
      new SpawnedAppServerConnection({ command: process.execPath, args: [appServer] })
    ),
    () => workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
  );
  activeRuntime = runtime;
  context.subscriptions.push(
    commands.registerCommand("deepcode.openPanel", () => {
      void commands.executeCommand("workbench.view.extension.deepcode");
    }),
    commands.registerCommand("deepcode.run", async () => {
      const editor = window.activeTextEditor;
      if (!editor) {
        void window.showInformationMessage("DeepCode: no active editor.");
        return;
      }
      const selection = editor.document.getText(editor.selection);
      if (!selection.trim()) {
        void window.showInformationMessage("DeepCode: select some text first.");
        return;
      }
      const prompt = await window.showInputBox({
        prompt: "Ask DeepCode about the selection",
        value: "Explain this code."
      });
      if (!prompt) return;
      await runInOutput(`${prompt}

----- Selected code -----
${selection}`, vscodeMod, runtime);
    }),
    commands.registerCommand("deepcode.review", async () => {
      if (!workspace.workspaceFolders?.[0]) {
        void window.showInformationMessage("DeepCode: open a folder first.");
        return;
      }
      try {
        latestReviewFindings.clear();
        const diff = await runtime.diff();
        if (!diff.repository || diff.files.length === 0) {
          void window.showInformationMessage("DeepCode: no uncommitted changes to review.");
          return;
        }
        await runInOutput(
          "Review the canonical workspace diff below. Cite file:line for each finding. Categorize as BUG / LATENT / SUGGESTION.\n\n" + formatWorkspaceDiffForReview(diff),
          vscodeMod,
          runtime
        );
      } catch (error) {
        void window.showErrorMessage(
          `DeepCode review failed: ${error.message ?? String(error)}`
        );
      }
    }),
    commands.registerCommand(
      "deepcode.applyReviewFinding",
      async (finding) => {
        if (!finding?.findingId) {
          void window.showErrorMessage("DeepCode: a review finding is required.");
          return;
        }
        await runFindingsInOutput([finding], vscodeMod, runtime);
      }
    ),
    commands.registerCommand("deepcode.applyAllReviewFindings", async () => {
      const findings = [...latestReviewFindings.values()];
      if (findings.length === 0) {
        void window.showInformationMessage("DeepCode: no review findings to apply.");
        return;
      }
      await runFindingsInOutput(findings, vscodeMod, runtime);
    }),
    commands.registerCommand(
      "deepcode.revertReviewAction",
      async (action) => {
        const actionId = action?.actionId ?? latestAppliedActionId;
        if (!actionId) {
          void window.showInformationMessage("DeepCode: no applied review action to revert.");
          return;
        }
        await runRevertInOutput(actionId, vscodeMod, runtime);
      }
    ),
    commands.registerCommand("deepcode.showDiagnostics", async () => {
      const out = window.createOutputChannel("DeepCode Diagnostics");
      out.show(true);
      try {
        const report = await runtime.diagnostics();
        for (const line of formatConfigDiagnostics(report)) out.appendLine(line);
      } catch (error) {
        out.appendLine(`\u2715 ${error.message ?? String(error)}`);
      }
    }),
    window.registerWebviewViewProvider("deepcode.chat", new ChatViewProvider(vscodeMod, runtime))
  );
}
async function runFindingsInOutput(findings, vscodeMod, runtime) {
  const out = vscodeMod.window.createOutputChannel("DeepCode");
  out.show(true);
  out.appendLine(
    findings.length === 1 ? `Applying review finding: ${findings[0].title}` : `Applying ${findings.length} review findings`
  );
  try {
    await runtime.applyFindings(findings, (event) => {
      projectOutputEvent(event, out);
      void respondToInteraction(event, vscodeMod, runtime);
    });
  } catch (error) {
    out.appendLine(`
\u2715 ${error.message ?? String(error)}`);
  }
}
async function runRevertInOutput(actionId, vscodeMod, runtime) {
  const out = vscodeMod.window.createOutputChannel("DeepCode");
  out.show(true);
  out.appendLine(`Reverting review action: ${actionId}`);
  try {
    await runtime.revertAction(actionId, (event) => {
      projectOutputEvent(event, out);
      void respondToInteraction(event, vscodeMod, runtime);
    });
  } catch (error) {
    out.appendLine(`
\u2715 ${error.message ?? String(error)}`);
  }
}
async function deactivate() {
  const runtime = activeRuntime;
  activeRuntime = void 0;
  await runtime?.close();
}
async function runInOutput(userMessage, vscodeMod, runtime) {
  const out = vscodeMod.window.createOutputChannel("DeepCode");
  out.show(true);
  out.appendLine(`\u258E DeepCode \xB7 ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`);
  out.appendLine(`  ${truncate(userMessage, 200)}`);
  out.appendLine("");
  try {
    await runtime.start(modelInput(userMessage, vscodeMod), (event) => {
      projectOutputEvent(event, out);
      void respondToInteraction(event, vscodeMod, runtime);
    });
  } catch (error) {
    out.appendLine(`
\u2715 ${error.message ?? String(error)}`);
  }
}
function modelInput(text, vscodeMod) {
  const config = vscodeMod.workspace.getConfiguration("deepcode");
  const model = explicitConfigValue(config.inspect("model"));
  const effort = explicitConfigValue(config.inspect("effort"));
  return {
    text,
    ...model ? { model } : {},
    ...effort ? { effort } : {}
  };
}
function projectOutputEvent(event, out) {
  switch (event.type) {
    case "item.delta":
      out.append(event.delta);
      break;
    case "tool.started":
      out.appendLine(`
[${event.name}] ${formatInput(event.input)}`);
      break;
    case "tool.completed":
      out.appendLine(
        `  ${event.result.isError ? "\u2715" : "\u2713"} ${truncate(event.result.content, 200)}`
      );
      break;
    case "approval.requested":
      out.appendLine(`
[approval] ${event.toolName}: ${event.reason}`);
      break;
    case "user-input.requested":
      out.appendLine(`
[input] ${event.question}`);
      break;
    case "turn.completed":
      out.appendLine("\n");
      break;
    case "turn.interrupted":
      out.appendLine("\n\u23F9 interrupted\n");
      break;
    case "turn.failed":
      out.appendLine(`
\u2715 ${turnError(event.turn) ?? "turn failed"}
`);
      break;
    case "item.completed":
      if (event.item.type === "review_finding") {
        const finding = event.item.payload;
        if (isReviewFindingPayload(finding)) {
          latestReviewFindings.set(finding.findingId, finding);
        }
        out.appendLine(
          `
[P${String(finding.priority)}] ${String(finding.title)} \u2014 ${String(finding.path)}:${String(finding.startLine)}`
        );
        out.appendLine(`  ${String(finding.body)}`);
      } else if (event.item.type === "review_action") {
        if (event.item.payload.kind === "apply" && typeof event.item.payload.actionId === "string") {
          latestAppliedActionId = event.item.payload.actionId;
        }
        out.appendLine(
          `
[review action] ${String(event.item.payload.kind)} ${String(
            event.item.payload.findingIds?.length ?? 0
          )} finding(s)`
        );
      }
      break;
  }
}
async function respondToInteraction(event, vscodeMod, runtime) {
  if (event.type === "approval.requested") {
    const choice = await vscodeMod.window.showWarningMessage(
      `${event.toolName}: ${event.reason}`,
      "Allow once",
      "Deny",
      "Always allow"
    );
    const decision = choice === "Always allow" ? "always" : choice === "Allow once" ? "allow" : "deny";
    await runtime.approve(event.turnId, event.requestId, decision);
  } else if (event.type === "user-input.requested") {
    const answer = event.options.length ? await vscodeMod.window.showQuickPick(
      event.options.map((option) => ({ label: option.label, description: option.description })),
      { placeHolder: event.question }
    ) : await vscodeMod.window.showInputBox({ prompt: event.question });
    await runtime.answer(
      event.turnId,
      event.requestId,
      typeof answer === "string" ? answer : answer?.label ?? ""
    );
  }
}
function formatInput(input) {
  for (const key of ["file_path", "command", "pattern", "path", "url", "query"]) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return JSON.stringify(input).slice(0, 80);
}
function turnError(turn) {
  return [...turn.items].reverse().find((item) => item.type === "error")?.payload.message;
}
function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length)}\u2026` : value;
}
var ChatViewProvider = class {
  constructor(vscodeMod, runtime) {
    this.vscodeMod = vscodeMod;
    this.runtime = runtime;
  }
  resolveWebviewView(view) {
    view.webview.options = { enableScripts: true };
    view.webview.html = chatHtml();
    view.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(view, message);
    });
  }
  async handleMessage(view, message) {
    if (message.kind !== "send" || !message.text) return;
    try {
      await this.runtime.start(modelInput(message.text, this.vscodeMod), (event) => {
        projectWebviewEvent(event, view);
        void respondToInteraction(event, this.vscodeMod, this.runtime);
      });
    } catch (error) {
      void view.webview.postMessage({
        kind: "assistant",
        text: `\u2715 ${error.message ?? String(error)}`
      });
    }
  }
};
function projectWebviewEvent(event, view) {
  switch (event.type) {
    case "item.delta":
      void view.webview.postMessage({ kind: "assistant_stream", text: event.delta });
      break;
    case "tool.started":
      void view.webview.postMessage({
        kind: "tool",
        text: `[${event.name}] ${formatInput(event.input)}`
      });
      break;
    case "tool.completed":
      void view.webview.postMessage({
        kind: "tool",
        text: `${event.result.isError ? "\u2715" : "\u2713"} ${truncate(event.result.content, 200)}`
      });
      break;
    case "approval.requested":
      void view.webview.postMessage({
        kind: "tool",
        text: `[approval] ${event.toolName}: ${event.reason}`
      });
      break;
    case "user-input.requested":
      void view.webview.postMessage({ kind: "tool", text: `[input] ${event.question}` });
      break;
    case "turn.completed":
    case "turn.interrupted":
      void view.webview.postMessage({ kind: "assistant_end" });
      break;
    case "turn.failed":
      void view.webview.postMessage({
        kind: "assistant",
        text: `\u2715 ${turnError(event.turn) ?? "turn failed"}`
      });
      break;
  }
}
function chatHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 8px; margin: 0; }
  #log { height: calc(100vh - 80px); overflow-y: auto; padding: 4px; }
  #log .msg { margin: 4px 0; padding: 6px 8px; border-radius: 3px; white-space: pre-wrap; }
  #log .user { background: var(--vscode-input-background); }
  #log .assistant { background: var(--vscode-editor-inactiveSelectionBackground); }
  #log .tool { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em; color: var(--vscode-descriptionForeground); }
  #composer { position: fixed; bottom: 0; left: 0; right: 0; padding: 8px; background: var(--vscode-sideBar-background); border-top: 1px solid var(--vscode-panel-border); }
  #composer input { width: 100%; box-sizing: border-box; padding: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
</style></head><body>
<div id="log"></div>
<div id="composer"><input id="msg" placeholder="Ask DeepCode\u2026" autofocus></div>
<script>
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const input = document.getElementById('msg');
  let streaming = null;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      const text = input.value;
      input.value = '';
      append('user', text);
      vscode.postMessage({ kind: 'send', text });
    }
  });
  window.addEventListener('message', (event) => {
    const m = event.data;
    if (m.kind === 'assistant_stream') {
      if (!streaming) streaming = append('assistant', '');
      streaming.textContent += m.text;
      log.scrollTop = log.scrollHeight;
    } else if (m.kind === 'assistant_end') {
      streaming = null;
    } else if (m.kind === 'tool') {
      append('tool', m.text);
    } else if (m.kind === 'assistant') {
      append('assistant', m.text);
      streaming = null;
    }
  });
  function append(role, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }
</script>
</body></html>`;
}
async function loadVscode() {
  return require("vscode");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.cjs.map
