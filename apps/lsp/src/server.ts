#!/usr/bin/env node
// DeepCode LSP server — exposes the agent loop to any LSP-capable IDE
// (Neovim, Emacs lsp-mode, Sublime, JetBrains via the LSP plugin, etc.).
// Spec: docs/DEVELOPMENT_PLAN.md §v1.1
//
// Wire format: LSP base protocol (JSON-RPC 2.0 over stdio, framed with
// `Content-Length: N\r\n\r\n<body>`). We expose 3 custom commands under
// `workspace/executeCommand`:
//
//   · deepcode.runAgent       — send a prompt; stream response back via
//                                deepcode/agentEvent notification
//   · deepcode.abort          — stop the active turn
//   · deepcode.listSkills     — return SKILL.md metadata
//
// Plus standard LSP boilerplate (initialize / initialized / shutdown /
// exit) so non-DeepCode-aware clients still handshake cleanly.

import { handleMessage, type LspMessage } from './handler.js';

function readMessages(onMessage: (msg: LspMessage) => void): void {
  let buffer = Buffer.alloc(0);
  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = buffer.subarray(0, headerEnd).toString('ascii');
      const m = /content-length:\s*(\d+)/i.exec(header);
      if (!m) {
        process.stderr.write(`malformed LSP header: ${header}\n`);
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const bodyLen = parseInt(m[1]!, 10);
      const totalLen = headerEnd + 4 + bodyLen;
      if (buffer.length < totalLen) return; // wait for more bytes
      const body = buffer.subarray(headerEnd + 4, totalLen).toString('utf8');
      buffer = buffer.subarray(totalLen);
      try {
        onMessage(JSON.parse(body) as LspMessage);
      } catch (err) {
        process.stderr.write(`malformed LSP body: ${(err as Error).message}\n`);
      }
    }
  });
}

function sendMessage(msg: LspMessage): void {
  const body = JSON.stringify(msg);
  const buf = Buffer.from(body, 'utf8');
  process.stdout.write(`Content-Length: ${buf.length}\r\n\r\n`);
  process.stdout.write(buf);
}

function main(): void {
  readMessages((msg) => {
    void handleMessage(msg, sendMessage).catch((err: Error) => {
      process.stderr.write(`handler crashed: ${err.message}\n${err.stack ?? ''}\n`);
    });
  });
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
}

if (process.argv[1]?.includes('server')) main();
