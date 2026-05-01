// Thin wrapper around the chrome.* APIs so tests can substitute a fake.
// Append-only — each ticket adds the methods it needs under a fence.

export interface BrowserApi {
  // === T02 — storage ===
  storageGet<T = unknown>(key: string): Promise<T | undefined>;
  storageSet(key: string, value: unknown): Promise<void>;
  // === /T02 ===

  // === T03 — read window/tabs/groups ===
  getWindow(windowId: number): Promise<chrome.windows.Window>;
  queryTabs(query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
  queryTabGroups(query: chrome.tabGroups.QueryInfo): Promise<chrome.tabGroups.TabGroup[]>;
  // === /T03 ===

  // === T04 — restore window/tabs/groups ===
  createWindow(opts: chrome.windows.CreateData): Promise<chrome.windows.Window | undefined>;
  createTab(opts: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab>;
  removeTab(tabId: number): Promise<void>;
  groupTabs(opts: chrome.tabs.GroupOptions): Promise<number>;
  updateTabGroup(
    groupId: number,
    props: chrome.tabGroups.UpdateProperties,
  ): Promise<chrome.tabGroups.TabGroup>;
  // === /T04 ===

  // === T05 — session storage for in-session bindings ===
  sessionStorageGet<T = unknown>(key: string): Promise<T | undefined>;
  sessionStorageSet(key: string, value: unknown): Promise<void>;
  // === /T05 ===

  // === T08 — alarms ===
  alarmsCreate(name: string, alarmInfo: chrome.alarms.AlarmCreateInfo): Promise<void>;
  alarmsClear(name: string): Promise<boolean>;
  alarmsOnAlarm(handler: (alarm: chrome.alarms.Alarm) => void): void;
  // === /T08 ===
}

export function createBrowser(): BrowserApi {
  return {
    // === T02 ===
    storageGet: async <T>(key: string) =>
      (await chrome.storage.local.get(key))[key] as T | undefined,
    storageSet: (key, value) => chrome.storage.local.set({ [key]: value }),
    // === /T02 ===

    // === T03 ===
    getWindow: (id) => chrome.windows.get(id, { populate: true }),
    queryTabs: (q) => chrome.tabs.query(q),
    queryTabGroups: (q) => chrome.tabGroups.query(q),
    // === /T03 ===

    // === T04 ===
    createWindow: (opts) => chrome.windows.create(opts),
    createTab: (opts) => chrome.tabs.create(opts),
    removeTab: (id) => chrome.tabs.remove(id),
    groupTabs: (opts) => chrome.tabs.group(opts),
    updateTabGroup: async (id, props) => {
      const g = await chrome.tabGroups.update(id, props);
      if (!g) throw new Error(`tabGroups.update returned undefined for groupId ${id}`);
      return g;
    },
    // === /T04 ===

    // === T05 ===
    sessionStorageGet: async <T>(key: string) =>
      (await chrome.storage.session.get(key))[key] as T | undefined,
    sessionStorageSet: (key, value) => chrome.storage.session.set({ [key]: value }),
    // === /T05 ===

    // === T08 ===
    alarmsCreate: async (name, info) => {
      await chrome.alarms.create(name, info);
    },
    alarmsClear: (name) => chrome.alarms.clear(name),
    alarmsOnAlarm: (handler) => {
      chrome.alarms.onAlarm.addListener(handler);
    },
    // === /T08 ===
  };
}
