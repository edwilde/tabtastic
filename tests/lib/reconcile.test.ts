import { describe, it, expect } from 'vitest';
import { planReconcile, type WindowInfo } from '../../src/lib/reconcile';
import type { Project } from '../../src/lib/types';

function project(name: string, id = name): Project {
  return {
    id,
    name,
    createdAt: 0,
    autoSlots: { hour: null, day: null, week: null, month: null },
    named: [],
  };
}

const NONE_W = new Set<number>();
const NONE_P = new Set<string>();

describe('planReconcile', () => {
  it('binds an unbound named window to its project', () => {
    const p = project('Tabtastic');
    const windows: WindowInfo[] = [{ id: 1, title: 'Tabtastic - GitHub - Google Chrome' }];
    expect(planReconcile(windows, [p], NONE_W, NONE_P)).toEqual([
      { windowId: 1, projectId: 'Tabtastic' },
    ]);
  });

  it('ignores the loose title-contains match — only strong name-window auto-binds', () => {
    const p = project('Acme');
    const windows: WindowInfo[] = [{ id: 1, title: 'GitHub · Acme/widgets · pull/9 - Google Chrome' }];
    expect(planReconcile(windows, [p], NONE_W, NONE_P)).toEqual([]);
  });

  it('skips windows that are already bound', () => {
    const p = project('Tabtastic');
    const windows: WindowInfo[] = [{ id: 1, title: 'Tabtastic - GitHub - Google Chrome' }];
    expect(planReconcile(windows, [p], new Set([1]), NONE_P)).toEqual([]);
  });

  it('skips projects already bound to a live window (first-wins)', () => {
    const p = project('Tabtastic');
    const windows: WindowInfo[] = [{ id: 2, title: 'Tabtastic - GitHub - Google Chrome' }];
    expect(planReconcile(windows, [p], NONE_W, new Set(['Tabtastic']))).toEqual([]);
  });

  it('does not assign one project to two windows in a single pass', () => {
    const p = project('Tabtastic');
    const windows: WindowInfo[] = [
      { id: 1, title: 'Tabtastic - GitHub - Google Chrome' },
      { id: 2, title: 'Tabtastic - Docs - Google Chrome' },
    ];
    expect(planReconcile(windows, [p], NONE_W, NONE_P)).toEqual([
      { windowId: 1, projectId: 'Tabtastic' },
    ]);
  });

  it('binds multiple distinct windows to their respective projects', () => {
    const a = project('Acme');
    const b = project('Beta');
    const windows: WindowInfo[] = [
      { id: 1, title: 'Acme - dashboard - Google Chrome' },
      { id: 2, title: 'Beta - inbox - Google Chrome' },
      { id: 3, title: 'New Tab - Google Chrome' },
    ];
    expect(planReconcile(windows, [a, b], NONE_W, NONE_P)).toEqual([
      { windowId: 1, projectId: 'Acme' },
      { windowId: 2, projectId: 'Beta' },
    ]);
  });

  it('returns nothing when there are no projects', () => {
    const windows: WindowInfo[] = [{ id: 1, title: 'Tabtastic - GitHub - Google Chrome' }];
    expect(planReconcile(windows, [], NONE_W, NONE_P)).toEqual([]);
  });
});
