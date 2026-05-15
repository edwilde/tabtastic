import { updateIconForTab, updateIconsForWindow } from '../icon-state';

// Active tab changed → refresh its icon for the new tab's binding.
chrome.tabs.onActivated.addListener((info) => {
  void updateIconForTab(info.tabId, info.windowId);
});

// New tab → set its icon based on its window's binding.
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id !== undefined && tab.windowId !== undefined) {
    void updateIconForTab(tab.id, tab.windowId);
  }
});

// Tab moved between windows → refresh its icon for the new window's binding.
chrome.tabs.onAttached.addListener((tabId, info) => {
  void updateIconForTab(tabId, info.newWindowId);
});

// Window focus changed → refresh icons for tabs in the newly focused window.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void updateIconsForWindow(windowId);
});
