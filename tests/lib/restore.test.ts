import { describe, it, expect } from 'vitest';
import { restoreSnapshot } from '../../src/lib/restore';
import type { Snapshot } from '../../src/lib/types';

function fakeBrowser(opts: { failOnUrl?: (url: string) => boolean } = {}) {
  const calls: { kind: string; payload: unknown }[] = [];
  let nextWindowId = 100;
  let nextTabId = 1;
  let nextGroupId = 1000;
  return {
    calls,
    browser: {
      createWindow: async (createOpts: chrome.windows.CreateData) => {
        const id = nextWindowId++;
        const tabId = nextTabId++;
        calls.push({ kind: 'window', payload: { id, opts: createOpts } });
        return { id, tabs: [{ id: tabId, url: createOpts.url }] } as chrome.windows.Window;
      },
      createTab: async (createOpts: chrome.tabs.CreateProperties) => {
        if (opts.failOnUrl?.(createOpts.url ?? '')) {
          throw new Error('blocked');
        }
        const id = nextTabId++;
        calls.push({ kind: 'tab', payload: { id, opts: createOpts } });
        return { id } as chrome.tabs.Tab;
      },
      removeTab: async (id: number) => {
        calls.push({ kind: 'removeTab', payload: { id } });
      },
      groupTabs: async (groupOpts: chrome.tabs.GroupOptions) => {
        const gid = nextGroupId++;
        calls.push({ kind: 'group', payload: { gid, opts: groupOpts } });
        return gid;
      },
      updateTabGroup: async (id: number, props: chrome.tabGroups.UpdateProperties) => {
        calls.push({ kind: 'updateGroup', payload: { id, props } });
        return { id, ...props } as chrome.tabGroups.TabGroup;
      },
    },
  };
}

const baseSnap = (): Snapshot => ({
  id: 's',
  takenAt: 0,
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
  ungroupedTabs: [{ url: 'https://misc.com', title: 'Misc' }],
});

describe('restoreSnapshot', () => {
  it('opens window with about:blank, creates groups in order, then ungrouped tabs', async () => {
    const { browser, calls } = fakeBrowser();
    const result = await restoreSnapshot(browser, baseSnap());

    expect(typeof result.windowId).toBe('number');
    expect(result.failures).toEqual([]);

    expect(calls[0]!.kind).toBe('window');
    expect((calls[0]!.payload as { opts: chrome.windows.CreateData }).opts.url).toBe(
      'about:blank',
    );

    const tabUrls = calls
      .filter((c) => c.kind === 'tab')
      .map((c) => (c.payload as { opts: chrome.tabs.CreateProperties }).opts.url);
    expect(tabUrls).toEqual([
      'https://a.com',
      'https://b.com',
      'https://c.com',
      'https://misc.com',
    ]);

    const groupTitles = calls
      .filter((c) => c.kind === 'updateGroup')
      .map((c) => (c.payload as { props: { title?: string } }).props.title);
    expect(groupTitles).toEqual(['🚀 frontend', '🚀 backend']);

    expect(calls.some((c) => c.kind === 'removeTab')).toBe(true);
  });

  it('records failures for blocked URLs without throwing', async () => {
    const { browser } = fakeBrowser({
      failOnUrl: (u) => u.startsWith('chrome://'),
    });
    const snap: Snapshot = {
      ...baseSnap(),
      groups: [
        {
          title: 'g',
          color: 'red',
          collapsed: false,
          tabs: [
            { url: 'https://ok.com', title: 'Ok' },
            { url: 'chrome://settings', title: 'Settings' },
          ],
        },
      ],
      ungroupedTabs: [],
    };
    const result = await restoreSnapshot(browser, snap);
    expect(result.failures.map((f) => f.url)).toEqual(['chrome://settings']);
  });

  it('handles an empty snapshot (no groups, no ungrouped tabs)', async () => {
    const { browser, calls } = fakeBrowser();
    const result = await restoreSnapshot(browser, {
      id: 'empty',
      takenAt: 0,
      windowName: 'Empty',
      groups: [],
      ungroupedTabs: [],
    });
    expect(result.failures).toEqual([]);
    // Window opens with about:blank, placeholder is then removed.
    expect(calls.some((c) => c.kind === 'window')).toBe(true);
    expect(calls.some((c) => c.kind === 'removeTab')).toBe(true);
  });
});
