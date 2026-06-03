import { AUTOSAVE_DELAY_MS, bindings, debouncer, ensureHydrated } from '../runtime';
import { reconcileBindings } from '../reconcile';

async function scheduleSave(windowId: number | undefined): Promise<void> {
  if (windowId === undefined || windowId < 0) return;
  await ensureHydrated();
  if (!bindings.projectIdFor(windowId)) return;
  await debouncer.schedule(String(windowId), AUTOSAVE_DELAY_MS);
}

// T28 — windows whose title wasn't ready (or didn't match) at onCreated get one
// more reconcile attempt once a tab finishes loading. Bounded to a single retry
// per window per service-worker lifetime so a long-lived unbound window doesn't
// re-run the pass on every tab load.
const reconcileTried = new Set<number>();
async function maybeReconcile(windowId: number | undefined): Promise<void> {
  if (windowId === undefined || windowId < 0) return;
  await ensureHydrated();
  if (bindings.projectIdFor(windowId) !== undefined) return; // already bound
  if (reconcileTried.has(windowId)) return;
  reconcileTried.add(windowId);
  await reconcileBindings();
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
  // A completed load is the point at which the window title (and thus any
  // "Name window" prefix) is reliably populated — retry auto-bind here.
  if (info.status === 'complete') void maybeReconcile(tab.windowId);
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
chrome.windows.onCreated.addListener(() => {
  // Covers the batch Chrome reopens after a restart and any new window mid-
  // session. A new blank window simply won't match and the pass no-ops.
  void reconcileBindings();
});
chrome.windows.onRemoved.addListener((wid) => {
  void debouncer.cancel(String(wid));
  void bindings.unbindWindow(wid);
  reconcileTried.delete(wid);
});

// Hydrate bindings on startup so projectIdFor() works after SW wake, then
// auto-bind any windows Chrome restored (session bindings were wiped on quit).
chrome.runtime.onInstalled.addListener(() => {
  void reconcileBindings();
});
chrome.runtime.onStartup.addListener(() => {
  void reconcileBindings();
});
