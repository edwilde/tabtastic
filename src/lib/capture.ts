import type { BrowserApi } from './browser';
import type { GroupColor, GroupSnap, Snapshot, TabSnap } from './types';

type CaptureDeps = Pick<BrowserApi, 'getWindow' | 'queryTabs' | 'queryTabGroups'>;

/**
 * Snapshots the current state of a window into a Snapshot.
 *
 * Note: `windowName` is captured for display only — it reflects the active
 * tab's <title>, not a stable user-set window name. Callers must NOT use
 * this to overwrite a project's persisted name.
 */
export async function captureSnapshot(
  browser: CaptureDeps,
  windowId: number,
  newId: () => string,
  now: () => number,
): Promise<Snapshot> {
  const [win, tabs, groups] = await Promise.all([
    browser.getWindow(windowId),
    browser.queryTabs({ windowId }),
    browser.queryTabGroups({ windowId }),
  ]);

  const sortedTabs = [...tabs].sort((a, b) => a.index - b.index);
  const tabsByGroup = new Map<number, chrome.tabs.Tab[]>();
  const ungroupedTabs: TabSnap[] = [];
  const firstIndexOfGroup = new Map<number, number>();

  for (const t of sortedTabs) {
    const gid = t.groupId;
    if (gid === undefined || gid === -1) {
      ungroupedTabs.push({ url: t.url ?? '', title: t.title ?? '' });
      continue;
    }
    if (!tabsByGroup.has(gid)) {
      tabsByGroup.set(gid, []);
      firstIndexOfGroup.set(gid, t.index);
    }
    tabsByGroup.get(gid)!.push(t);
  }

  const orderedGroupIds = [...firstIndexOfGroup.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
  const groupById = new Map(groups.map((g) => [g.id, g]));

  const groupSnaps: GroupSnap[] = orderedGroupIds
    .map((gid) => {
      const g = groupById.get(gid);
      if (!g) return null;
      return {
        title: g.title ?? '',
        color: g.color as GroupColor,
        collapsed: g.collapsed,
        tabs: (tabsByGroup.get(gid) ?? []).map((t) => ({
          url: t.url ?? '',
          title: t.title ?? '',
        })),
      } satisfies GroupSnap;
    })
    .filter((x): x is GroupSnap => x !== null);

  // Window.title isn't in every @types/chrome version; fall back gracefully.
  const windowName =
    (win as unknown as { title?: string }).title ?? '';

  return {
    id: newId(),
    takenAt: now(),
    windowName,
    groups: groupSnaps,
    ungroupedTabs,
  };
}
