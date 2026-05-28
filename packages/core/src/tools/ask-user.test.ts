import { describe, expect, it } from 'vitest';
import { AskUserQuestionTool } from './ask-user.js';

describe('AskUserQuestionTool', () => {
  it('errors when no askUser callback is provided', async () => {
    const r = await AskUserQuestionTool.execute(
      { question: 'Which library?', options: [{ label: 'A' }, { label: 'B' }] },
      { cwd: '/x' },
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/no interactive host/i);
  });

  it('errors when question is missing', async () => {
    const r = await AskUserQuestionTool.execute({}, { cwd: '/x' });
    expect(r.isError).toBe(true);
  });

  it('forwards to askUser and returns the chosen answer', async () => {
    let captured: { question: string; options: unknown[] } | null = null;
    const r = await AskUserQuestionTool.execute(
      {
        question: 'A or B?',
        options: [{ label: 'A', description: 'first' }, { label: 'B', description: 'second' }],
      },
      {
        cwd: '/x',
        askUser: async (req) => {
          captured = req;
          return 'A';
        },
      },
    );
    expect(r.isError).toBeFalsy();
    expect(r.content).toBe('A');
    expect(captured!.question).toBe('A or B?');
    expect(captured!.options).toHaveLength(2);
  });

  it('rejects more than 4 options', async () => {
    const r = await AskUserQuestionTool.execute(
      {
        question: 'pick',
        options: [{ label: '1' }, { label: '2' }, { label: '3' }, { label: '4' }, { label: '5' }],
      },
      { cwd: '/x', askUser: async () => '1' },
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/at most 4/);
  });

  it('passes multiSelect through to the host', async () => {
    let gotMulti = false;
    await AskUserQuestionTool.execute(
      { question: 'pick', options: [{ label: 'A' }], multiSelect: true },
      {
        cwd: '/x',
        askUser: async (req) => {
          gotMulti = !!req.multiSelect;
          return 'A';
        },
      },
    );
    expect(gotMulti).toBe(true);
  });

  it('surfaces host callback errors as tool errors', async () => {
    const r = await AskUserQuestionTool.execute(
      { question: 'pick' },
      {
        cwd: '/x',
        askUser: async () => {
          throw new Error('user aborted');
        },
      },
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/user aborted/);
  });
});
