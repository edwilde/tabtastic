import { bindings, debouncer, ensureHydrated } from '../runtime';

// T11 — flush pending auto-saves on window blur so a fresh snapshot lands
// before the user might do anything destructive.
chrome.windows.onFocusChanged.addListener(async (focusedId) => {
  await ensureHydrated();
  const all = bindings.allBoundWindows();
  if (focusedId === chrome.windows.WINDOW_ID_NONE) {
    // Focus left Chrome entirely — flush every bound window.
    for (const wid of all) {
      void debouncer.flushNow(String(wid));
    }
    return;
  }
  // Focus moved to a different window — flush all others.
  for (const wid of all) {
    if (wid !== focusedId) void debouncer.flushNow(String(wid));
  }
});
