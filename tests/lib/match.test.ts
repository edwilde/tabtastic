import { describe, it, expect } from 'vitest';
import { bestTitleMatch } from '../../src/lib/match';
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

describe('bestTitleMatch', () => {
  it('returns null when no projects', () => {
    expect(bestTitleMatch('Anything', [])).toBeNull();
  });

  it('matches a Chrome name-window prefix', () => {
    const p = project('Tabtastic');
    const m = bestTitleMatch('Tabtastic - GitHub - Google Chrome', [p]);
    expect(m).toEqual({ project: p, reason: 'name-window' });
  });

  it('is case-insensitive on the prefix match', () => {
    const p = project('Tabtastic');
    const m = bestTitleMatch('tabtastic - GitHub - Google Chrome', [p]);
    expect(m?.reason).toBe('name-window');
    expect(m?.project).toBe(p);
  });

  it('handles unicode en-dash separators', () => {
    const p = project('Tabtastic');
    const m = bestTitleMatch('Tabtastic – GitHub – Google Chrome', [p]);
    expect(m?.reason).toBe('name-window');
  });

  it('strips Chrome unread-tab notification counter', () => {
    const p = project('Tabtastic');
    const m = bestTitleMatch('(12) Tabtastic - GitHub - Google Chrome', [p]);
    expect(m?.reason).toBe('name-window');
  });

  it('falls back to word-boundary contains', () => {
    const p = project('Acme');
    const m = bestTitleMatch('GitHub · Acme/widgets · pull/9 - Google Chrome', [p]);
    expect(m).toEqual({ project: p, reason: 'title-contains' });
  });

  it('prefers name-window match over contains across projects', () => {
    const a = project('Acme');
    const b = project('Beta');
    // Title carries Beta as a prefix and Acme as a substring elsewhere.
    const m = bestTitleMatch('Beta - Acme rolls - Google Chrome', [a, b]);
    expect(m?.project).toBe(b);
    expect(m?.reason).toBe('name-window');
  });

  it('does not match a partial word', () => {
    const p = project('Acme');
    expect(bestTitleMatch('Welcome to Acmewidgets - Google Chrome', [p])).toBeNull();
  });

  it('handles regex metacharacters in project names', () => {
    const p = project('C++ (work)');
    // The matcher must not throw and must find the name embedded in the title.
    const m = bestTitleMatch('Notes on C++ (work) - Google Chrome', [p]);
    expect(m?.project).toBe(p);
    expect(m?.reason).toBe('title-contains');
  });

  it('returns null when nothing matches', () => {
    const p = project('Acme');
    expect(bestTitleMatch('Random tab title - Google Chrome', [p])).toBeNull();
  });
});
