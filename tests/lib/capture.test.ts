import { describe, it, expect } from 'vitest';
import { captureSnapshot } from '../../src/lib/capture';

// Loose typing for fixtures — the implementation only reads a small subset
// of fields, so we type-cast at the boundary rather than spell out every
// chrome.* required field per fixture.
const fakeBrowser = (win: unknown, tabs: unknown[], groups: unknown[]) => ({
  getWindow: async () => win as chrome.windows.Window,
  queryTabs: async () => tabs as chrome.tabs.Tab[],
  queryTabGroups: async () => groups as chrome.tabGroups.TabGroup[],
});

describe('captureSnapshot', () => {
  it('captures groups in tab order with their tabs', async () => {
    const tabs = [
      { id: 1, windowId: 10, index: 0, groupId: 100, url: 'https://a.com', title: 'A' },
      { id: 2, windowId: 10, index: 1, groupId: 100, url: 'https://b.com', title: 'B' },
      { id: 3, windowId: 10, index: 2, groupId: 101, url: 'https://c.com', title: 'C' },
    ];
    const groups = [
      { id: 100, title: '🚀 frontend', color: 'blue', collapsed: false, windowId: 10 },
      { id: 101, title: '🚀 backend', color: 'green', collapsed: true, windowId: 10 },
    ];
    const win = { id: 10, title: 'Acme' };

    const snap = await captureSnapshot(
      fakeBrowser(win, tabs, groups),
      10,
      () => 'fixed-id',
      () => 1700,
    );

    expect(snap).toEqual({
      id: 'fixed-id',
      takenAt: 1700,
      windowName: 'Acme',
      groups: [
        {
          title: '🚀 frontend',
          color: 'blue',
          collapsed: false,
          tabs: [
            { url: 'https://a.com', title: 'A' },
            { url: 'https://b.com', title: 'B' },
          ],
        },
        {
          title: '🚀 backend',
          color: 'green',
          collapsed: true,
          tabs: [{ url: 'https://c.com', title: 'C' }],
        },
      ],
      ungroupedTabs: [],
    });
  });

  it('puts ungrouped tabs (groupId -1) in ungroupedTabs preserving order', async () => {
    const tabs = [
      { id: 1, windowId: 10, index: 0, groupId: -1, url: 'https://a.com', title: 'A' },
      { id: 2, windowId: 10, index: 1, groupId: -1, url: 'https://b.com', title: 'B' },
    ];
    const win = { id: 10, title: 'W' };

    const snap = await captureSnapshot(
      fakeBrowser(win, tabs, []),
      10,
      () => 'id',
      () => 0,
    );

    expect(snap.groups).toEqual([]);
    expect(snap.ungroupedTabs).toEqual([
      { url: 'https://a.com', title: 'A' },
      { url: 'https://b.com', title: 'B' },
    ]);
  });

  it('preserves group order based on first tab index', async () => {
    const tabs = [
      { id: 1, windowId: 10, index: 0, groupId: 200, url: 'https://x.com', title: 'X' },
      { id: 2, windowId: 10, index: 1, groupId: 100, url: 'https://y.com', title: 'Y' },
    ];
    const groups = [
      { id: 100, title: 'second', color: 'red', collapsed: false, windowId: 10 },
      { id: 200, title: 'first', color: 'blue', collapsed: false, windowId: 10 },
    ];
    const win = { id: 10, title: 'W' };

    const snap = await captureSnapshot(
      fakeBrowser(win, tabs, groups),
      10,
      () => 'id',
      () => 0,
    );
    expect(snap.groups.map((g) => g.title)).toEqual(['first', 'second']);
  });

  it('preserves order of ungrouped tabs interleaved with groups', async () => {
    const tabs = [
      { id: 1, windowId: 10, index: 0, groupId: -1, url: 'https://a.com', title: 'A' },
      { id: 2, windowId: 10, index: 1, groupId: 100, url: 'https://b.com', title: 'B' },
      { id: 3, windowId: 10, index: 2, groupId: -1, url: 'https://c.com', title: 'C' },
    ];
    const groups = [{ id: 100, title: 'g', color: 'cyan', collapsed: false, windowId: 10 }];
    const win = { id: 10, title: 'W' };
    const snap = await captureSnapshot(
      fakeBrowser(win, tabs, groups),
      10,
      () => 'id',
      () => 0,
    );
    expect(snap.ungroupedTabs.map((t) => t.url)).toEqual(['https://a.com', 'https://c.com']);
    expect(snap.groups[0]!.tabs[0]!.url).toBe('https://b.com');
  });
});
