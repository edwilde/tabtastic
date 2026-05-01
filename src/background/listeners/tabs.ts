import { AUTOSAVE_DELAY_MS, bindings, debouncer, ensureHydrated } from '../runtime';

async function scheduleSave(windowId: number | undefined): Promise<void> {
  if (windowId === undefined || windowId < 0) return;
  await ensureHydrated();
  if (!bindings.projectIdFor(windowId)) return;
  await debouncer.schedule(String(windowId), AUTOSAVE_DELAY_MS);
}

// chrome.tabs.* — covers add/remove/move/attach/detach.
chrome.tabs.onCreated.addListener((tab) => {
  void scheduleSave(tab.windowId);
});
chrome.tabs.onRemoved.addListener((_id, info) => {
  if (info.isWindowClosing) return; // window-removed handler will clean up
  void scheduleSave(info.windowId);
});
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  // Filter to "complete" + group-membership changes to avoid debouncer spam
  // on every favicon/title/loading transition.
  if (info.status !== 'complete' && info.groupId === undefined) return;
  void scheduleSave(tab.windowId);
});
chrome.tabs.onMoved.addListener((_id, info) => {
  void scheduleSave(info.windowId);
});
chrome.tabs.onAttached.addListener((_id, info) => {
  void scheduleSave(info.newWindowId);
});
chrome.tabs.onDetached.addListener((_id, info) => {
  void scheduleSave(info.oldWindowId);
});

// chrome.tabGroups.* — onMoved does NOT exist on tabGroups; do not register.
chrome.tabGroups.onCreated.addListener((g) => {
  void scheduleSave(g.windowId);
});
chrome.tabGroups.onUpdated.addListener((g) => {
  void scheduleSave(g.windowId);
});
chrome.tabGroups.onRemoved.addListener((g) => {
  void scheduleSave(g.windowId);
});

// Window lifecycle.
chrome.windows.onRemoved.addListener((wid) => {
  void debouncer.cancel(String(wid));
  void bindings.unbindWindow(wid);
});

// Hydrate bindings on startup so projectIdFor() works after SW wake.
chrome.runtime.onInstalled.addListener(() => {
  void ensureHydrated();
});
chrome.runtime.onStartup.addListener(() => {
  void ensureHydrated();
});
