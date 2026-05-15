// T27 — keep the toolbar icon in sync with whether the active tab's window
// is bound to a Tabtastic! project. Bound → teal. Unbound → slate grey
// (reads as "disabled" on both light and dark Chrome toolbars).

import { bindings, ensureHydrated } from './runtime';

type IconPath = Record<number, string>;

const TEAL: IconPath = {
  16: 'src/assets/icon-16.png',
  32: 'src/assets/icon-32.png',
};
const GREY: IconPath = {
  16: 'src/assets/icon-grey-16.png',
  32: 'src/assets/icon-grey-32.png',
};

export async function updateIconForTab(tabId: number, windowId: number): Promise<void> {
  await ensureHydrated();
  const bound = windowId >= 0 && bindings.projectIdFor(windowId) !== undefined;
  try {
    await chrome.action.setIcon({ tabId, path: bound ? TEAL : GREY });
  } catch {
    // tab may have been closed mid-call — non-fatal
  }
}

export async function updateIconsForWindow(windowId: number): Promise<void> {
  if (windowId < 0) return;
  try {
    const tabs = await chrome.tabs.query({ windowId });
    await Promise.all(
      tabs
        .filter((t): t is chrome.tabs.Tab & { id: number } => t.id !== undefined)
        .map((t) => updateIconForTab(t.id, windowId)),
    );
  } catch {
    // window may have closed — non-fatal
  }
}
