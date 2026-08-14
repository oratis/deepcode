import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../sessions/manager.js';
import { SessionReadTool, SessionSearchTool } from './session-search.js';
import type { StoredMessage, ToolContext } from '../types.js';

function message(role: 'user' | 'assistant', text: string): StoredMessage {
  return { role, content: [{ type: 'text', text }], timestamp: '2026-08-01T00:00:00.000Z' };
}

describe('SessionSearch / SessionRead', () => {
  let root: string;
  let manager: SessionManager;
  let ctx: ToolContext;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dc-session-tools-'));
    manager = new SessionManager({ root });
    ctx = { cwd: '/work/app', sessionsRoot: root };
  });

  async function seed(cwd: string, texts: string[]): Promise<string> {
    const session = await manager.create(cwd);
    for (const [i, text] of texts.entries()) {
      await manager.append(session.id, message(i % 2 === 0 ? 'user' : 'assistant', text));
    }
    return session.id;
  }

  it('reports a hit with the id and offset needed to read it', async () => {
    const id = await seed('/work/app', ['the flaky test was a port collision']);
    const out = await SessionSearchTool.execute({ query: 'port collision' }, ctx);

    expect(out.isError).toBeFalsy();
    expect(out.content).toContain(`${id}#0`);
    expect(out.content).toContain('port collision');
    expect(out.content).toContain('SessionRead');
  });

  it('says plainly when there is nothing, rather than returning an empty list', async () => {
    await seed('/work/app', ['unrelated']);
    const out = await SessionSearchTool.execute({ query: 'nothing here' }, ctx);
    expect(out.content).toContain('No matches');
    expect(out.isError).toBeFalsy();
  });

  it('rejects a missing query instead of matching everything', async () => {
    expect((await SessionSearchTool.execute({}, ctx)).isError).toBe(true);
    expect((await SessionSearchTool.execute({ query: '  ' }, ctx)).isError).toBe(true);
  });

  it('has no argument that widens the search past the workspace', () => {
    // Widening scope is a user setting. A tool parameter would let the model
    // consent to reading another project's history on the user's behalf.
    const props = SessionSearchTool.definition.inputSchema['properties'] as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['limit', 'query']);
  });

  it('does not surface another workspace by default', async () => {
    await seed('/work/other', ['the secret is hunter2']);
    const out = await SessionSearchTool.execute({ query: 'hunter2' }, ctx);
    expect(out.content).toContain('No matches');
  });

  it('surfaces another workspace when the user turned that on', async () => {
    await seed('/work/other', ['the secret is hunter2']);
    const out = await SessionSearchTool.execute(
      { query: 'hunter2' },
      { ...ctx, sessionSearchScope: 'all' },
    );
    expect(out.content).toContain('hunter2');
  });

  it('reads back the messages around a hit', async () => {
    const id = await seed('/work/app', ['first', 'second', 'third']);
    const out = await SessionReadTool.execute({ session_id: id, offset: 1 }, ctx);
    expect(out.content).toContain('#1 assistant');
    expect(out.content).toContain('second');
    expect(out.content).not.toContain('first');
  });

  it('says how much more there is to read', async () => {
    const id = await seed('/work/app', ['a', 'b', 'c', 'd']);
    const out = await SessionReadTool.execute({ session_id: id, limit: 2 }, ctx);
    expect(out.content).toContain('2 more message(s)');
  });

  it('refuses to read another workspace even given its id', async () => {
    // Knowing an id is not authorization. Without this, search scoping would be
    // a suggestion rather than a rule.
    const id = await seed('/work/other', ['private']);
    const out = await SessionReadTool.execute({ session_id: id }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('another workspace');
    expect(out.content).not.toContain('private');
  });

  it('reports an unknown session instead of returning nothing', async () => {
    const out = await SessionReadTool.execute({ session_id: 'no-such-session' }, ctx);
    expect(out.isError).toBe(true);
  });

  it('reports an offset past the end instead of pretending the session is empty', async () => {
    const id = await seed('/work/app', ['only one']);
    const out = await SessionReadTool.execute({ session_id: id, offset: 99 }, ctx);
    expect(out.content).toContain('past the end');
  });
});
