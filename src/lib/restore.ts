import type { BrowserApi } from './browser';
import type { RestoreFailure, RestoreResult, Snapshot, TabSnap } from './types';

type RestoreDeps = Pick<
  BrowserApi,
  'createWindow' | 'createTab' | 'removeTab' | 'groupTabs' | 'updateTabGroup'
>;

/**
 * Recreates a window from a Snapshot.
 *
 * Strategy: open the new window with `about:blank` as a placeholder, then
 * create every saved tab via createTab and remove the placeholder. We do
 * NOT depend on chrome.windows.create returning a populated `tabs` array
 * — in MV3 it is often undefined or empty.
 */
export async function restoreSnapshot(
  browser: RestoreDeps,
  snap: Snapshot,
): Promise<RestoreResult> {
  const failures: RestoreFailure[] = [];

  const win = await browser.createWindow({ url: 'about:blank', focused: true });
  const windowId = win?.id;
  if (windowId === undefined) {
    throw new Error('createWindow returned no id');
  }
  const placeholderId = win?.tabs?.[0]?.id;

  async function recreateTab(t: TabSnap): Promise<number | null> {
    try {
      const tab = await browser.createTab({ windowId, url: t.url, active: false });
      return tab.id ?? null;
    } catch (e) {
      failures.push({ url: t.url, reason: (e as Error).message });
      return null;
    }
  }

  for (const group of snap.groups) {
    const tabIds: number[] = [];
    for (const t of group.tabs) {
      const id = await recreateTab(t);
      if (id !== null) tabIds.push(id);
    }
    if (tabIds.length === 0) continue;
    try {
      const groupId = await browser.groupTabs({
        tabIds: tabIds as [number, ...number[]],
        createProperties: { windowId },
      });
      await browser.updateTabGroup(groupId, {
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
      });
    } catch (e) {
      failures.push({
        url: `(group) ${group.title}`,
        reason: (e as Error).message,
      });
    }
  }

  for (const t of snap.ungroupedTabs) {
    await recreateTab(t);
  }

  // Drop the placeholder once the snapshot's tabs are in place.
  if (placeholderId !== undefined) {
    try {
      await browser.removeTab(placeholderId);
    } catch {
      // Non-fatal: leave it open if Chrome refused.
    }
  }

  return { windowId, failures };
}
