import { describe, expect, it } from 'vitest';
import type { FileTab } from '../types/file-panel.js';
import { filePanelReducer, initialFilePanelState } from './file-panel-reducer.js';

const tab = (path: string): FileTab => ({ path, source: `// ${path}`, diff: null, history: [] });

describe('filePanelReducer', () => {
  it('open adds a tab and activates it', () => {
    let s = initialFilePanelState();
    s = filePanelReducer(s, { type: 'open', tab: tab('/a.ts') });
    s = filePanelReducer(s, { type: 'open', tab: tab('/b.ts') });
    expect(s.tabs.map((t) => t.path)).toEqual(['/a.ts', '/b.ts']);
    expect(s.activeIndex).toBe(1);
  });

  it('re-opening an existing path refreshes data and activates without duplicating', () => {
    let s = initialFilePanelState();
    s = filePanelReducer(s, { type: 'open', tab: tab('/a.ts') });
    s = filePanelReducer(s, { type: 'open', tab: tab('/b.ts') });
    s = filePanelReducer(s, {
      type: 'open',
      tab: { ...tab('/a.ts'), source: 'updated', unsaved: true },
    });
    expect(s.tabs).toHaveLength(2);
    expect(s.activeIndex).toBe(0);
    expect(s.tabs[0]?.source).toBe('updated');
    expect(s.tabs[0]?.unsaved).toBe(true);
  });

  it('close shifts activeIndex correctly when closing before the active tab', () => {
    let s = initialFilePanelState();
    for (const p of ['/a.ts', '/b.ts', '/c.ts'])
      s = filePanelReducer(s, { type: 'open', tab: tab(p) });
    // active is /c.ts (index 2); close /a.ts (index 0) → active stays /c.ts (now index 1)
    s = filePanelReducer(s, { type: 'close', index: 0 });
    expect(s.tabs.map((t) => t.path)).toEqual(['/b.ts', '/c.ts']);
    expect(s.activeIndex).toBe(1);
  });

  it('closing the active last tab moves active to the new last', () => {
    let s = initialFilePanelState();
    for (const p of ['/a.ts', '/b.ts']) s = filePanelReducer(s, { type: 'open', tab: tab(p) });
    s = filePanelReducer(s, { type: 'close', index: 1 }); // close active /b.ts
    expect(s.tabs.map((t) => t.path)).toEqual(['/a.ts']);
    expect(s.activeIndex).toBe(0);
  });

  it('close ignores out-of-range index', () => {
    let s = initialFilePanelState();
    s = filePanelReducer(s, { type: 'open', tab: tab('/a.ts') });
    const before = s;
    s = filePanelReducer(s, { type: 'close', index: 9 });
    expect(s).toBe(before);
  });

  it('view + toggleDiffMode', () => {
    let s = initialFilePanelState();
    s = filePanelReducer(s, { type: 'view', view: 'diff' });
    expect(s.view).toBe('diff');
    expect(s.diffMode).toBe('inline');
    s = filePanelReducer(s, { type: 'toggleDiffMode' });
    expect(s.diffMode).toBe('split');
    s = filePanelReducer(s, { type: 'toggleDiffMode' });
    expect(s.diffMode).toBe('inline');
  });

  it('width is clamped to 320–800', () => {
    let s = initialFilePanelState();
    s = filePanelReducer(s, { type: 'width', width: 100 });
    expect(s.width).toBe(320);
    s = filePanelReducer(s, { type: 'width', width: 9999 });
    expect(s.width).toBe(800);
    s = filePanelReducer(s, { type: 'width', width: 555 });
    expect(s.width).toBe(555);
  });

  it('next/prev wrap around the open tabs', () => {
    let s = initialFilePanelState();
    for (const p of ['/a.ts', '/b.ts', '/c.ts'])
      s = filePanelReducer(s, { type: 'open', tab: tab(p) });
    s = filePanelReducer(s, { type: 'select', index: 2 });
    s = filePanelReducer(s, { type: 'nextTab' }); // wraps to 0
    expect(s.activeIndex).toBe(0);
    s = filePanelReducer(s, { type: 'prevTab' }); // wraps to 2
    expect(s.activeIndex).toBe(2);
  });

  it('next/prev are no-ops with no tabs', () => {
    const s = initialFilePanelState();
    expect(filePanelReducer(s, { type: 'nextTab' })).toBe(s);
    expect(filePanelReducer(s, { type: 'prevTab' })).toBe(s);
  });

  it('setDiff replaces the matching tab’s diff and leaves others intact', () => {
    let s = initialFilePanelState();
    for (const p of ['/a.ts', '/b.ts']) s = filePanelReducer(s, { type: 'open', tab: tab(p) });
    const diff = [{ kind: 'add' as const, oldNo: null, newNo: 1, text: 'x' }];
    s = filePanelReducer(s, { type: 'setDiff', path: '/a.ts', diff });
    expect(s.tabs[0]?.diff).toEqual(diff);
    expect(s.tabs[1]?.diff).toBeNull();
  });

  it('setDiff is a no-op for an unopened path', () => {
    let s = initialFilePanelState();
    s = filePanelReducer(s, { type: 'open', tab: tab('/a.ts') });
    const before = s;
    s = filePanelReducer(s, { type: 'setDiff', path: '/missing.ts', diff: [] });
    expect(s).toBe(before);
  });
});
