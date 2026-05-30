import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSlashCommands, findCustomCommand, expandCommandBody } from './index.js';

describe('expandCommandBody', () => {
  it('substitutes $ARGUMENTS and positional $1/$2', () => {
    expect(expandCommandBody('Review $1 against $2: $ARGUMENTS', ['a.ts', 'b.ts'])).toBe(
      'Review a.ts against b.ts: a.ts b.ts',
    );
  });
  it('replaces missing positionals with empty string', () => {
    expect(expandCommandBody('x=$1 y=$2', ['only'])).toBe('x=only y=');
  });
  it('handles no placeholders', () => {
    expect(expandCommandBody('just a prompt', ['ignored'])).toBe('just a prompt');
  });
});

describe('loadSlashCommands', () => {
  let home: string;
  let cwd: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-cmd-home-'));
    cwd = await mkdtemp(join(tmpdir(), 'dc-cmd-cwd-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it('returns [] when no commands dir exists', async () => {
    expect(await loadSlashCommands({ cwd, home })).toEqual([]);
  });

  it('loads user + project commands with frontmatter', async () => {
    await mkdir(join(home, '.deepcode', 'commands'), { recursive: true });
    await writeFile(
      join(home, '.deepcode', 'commands', 'greet.md'),
      '---\ndescription: say hi\nargument-hint: <name>\n---\nGreet $1 warmly.',
    );
    await mkdir(join(cwd, '.deepcode', 'commands'), { recursive: true });
    await writeFile(join(cwd, '.deepcode', 'commands', 'review.md'), 'Review the diff.');

    const cmds = await loadSlashCommands({ cwd, home });
    const greet = findCustomCommand(cmds, '/greet');
    const review = findCustomCommand(cmds, '/review');
    expect(greet).toMatchObject({
      name: '/greet',
      description: 'say hi',
      argumentHint: '<name>',
      source: 'user',
      body: 'Greet $1 warmly.',
    });
    expect(review).toMatchObject({ name: '/review', source: 'project' });
    // no frontmatter → description defaults to the base filename
    expect(review?.description).toBe('review');
  });

  it('project command overrides a user command of the same name', async () => {
    await mkdir(join(home, '.deepcode', 'commands'), { recursive: true });
    await writeFile(join(home, '.deepcode', 'commands', 'x.md'), 'user version');
    await mkdir(join(cwd, '.deepcode', 'commands'), { recursive: true });
    await writeFile(join(cwd, '.deepcode', 'commands', 'x.md'), 'project version');

    const cmds = await loadSlashCommands({ cwd, home });
    const x = findCustomCommand(cmds, '/x');
    expect(x?.source).toBe('project');
    expect(x?.body).toBe('project version');
    expect(cmds.filter((c) => c.name === '/x')).toHaveLength(1);
  });

  it('ignores non-.md files', async () => {
    await mkdir(join(cwd, '.deepcode', 'commands'), { recursive: true });
    await writeFile(join(cwd, '.deepcode', 'commands', 'notes.txt'), 'nope');
    await writeFile(join(cwd, '.deepcode', 'commands', 'real.md'), 'yes');
    const cmds = await loadSlashCommands({ cwd, home });
    expect(cmds.map((c) => c.name)).toEqual(['/real']);
  });
});
