# Tabtastic! Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a Manifest V3 Chrome extension that auto-saves the state of each project window (groups, colors, names, tab order) on a 4-slot Time Machine retention model, supports unlimited manual named snapshots, and can restore any snapshot into a fresh window.

**Architecture:** Service worker owns all listeners, the binding map (`windowId → projectId`), and storage. Pure functions for retention rotation and snapshot serialization are unit-tested in isolation. All `chrome.*` API calls funnel through one `browser.ts` wrapper module so tests can swap in a fake. Popup is current-window-focused; options page handles all-projects management and export/import.

**Tech Stack:** TypeScript, Vite + `@crxjs/vite-plugin` (handles MV3 manifest, service worker bundling, HMR), Vitest (unit tests), Chrome Extensions Manifest V3.

**Reference:** Full design at `docs/plans/2026-05-01-chrome-project-snapshots-design.md`.

---

## Conventions

- **Commit after every task.** Conventional Commits style: `feat:`, `test:`, `chore:`, `fix:`, `docs:`.
- **TDD where it pays off.** Pure functions (retention rotation, snapshot capture from a fake window, conflict resolution, debouncer) get tests-first. Chrome-API-touching code gets thin wrappers + manual smoke tests.
- **No premature abstractions.** Wrappers exist only for testability of the things we test.
- **One task = one commit.** Steps inside a task are micro-actions (write test → run → implement → run → commit).

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `src/manifest.ts` (manifest factory consumed by `@crxjs/vite-plugin`)
- Create: `.gitignore` (extend existing)

**Step 1: Initialise npm project**

Run: `npm init -y`
Then edit `package.json` to set:
```json
{
  "name": "tabtastic",
  "version": "0.1.0",
  "description": "Window Time Machine — save and restore your Chrome project windows.",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

**Step 2: Install dependencies**

Run (in background, this takes ~30s):
```
npm install -D typescript vite @crxjs/vite-plugin vitest @types/chrome @vitest/ui
```

Expected: `node_modules/` populated, `package-lock.json` created.

**Step 3: Add `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["chrome", "vitest/globals"],
    "lib": ["ES2022", "DOM"],
    "outDir": "dist",
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["src", "tests"]
}
```

**Step 4: Add `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: { outDir: 'dist' },
});
```

**Step 5: Add `vitest.config.ts` and a chrome global stub**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup/chrome-stub.ts'],
    passWithNoTests: true,
  },
});
```

`tests/setup/chrome-stub.ts`:
```ts
// Minimal global.chrome stub so modules importing browser.ts don't ReferenceError
// during test collection. Tests pass fakes into our wrapper-creating functions,
// so the stub only needs to exist — its methods should never be invoked.
const noop = () => { throw new Error('chrome.* called in tests — pass a fake instead'); };
(globalThis as { chrome?: unknown }).chrome = new Proxy({}, {
  get() { return new Proxy(noop, { get: () => noop, apply: noop }); },
});
```

**Step 6: Add `src/manifest.ts` (skeleton)**

```ts
import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Tabtastic!',
  description: 'Window Time Machine — save and restore your Chrome project windows: tab groups, colors, names, and all.',
  version: '0.1.0',
  permissions: ['tabs', 'tabGroups', 'windows', 'storage', 'alarms'],
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  action: { default_popup: 'src/popup/index.html', default_title: 'Tabtastic!' },
  options_page: 'src/options/index.html',
});
```

**Step 7: Extend `.gitignore`**

Append:
```
package-lock.json
```
*(Actually keep `package-lock.json`. Just ensure existing `node_modules/`, `dist/` lines stand.)*

**Step 8: Verify build doesn't error**

Run: `npm run typecheck`
Expected: No output (ts-only check; `src/background/index.ts` doesn't exist yet so this WILL fail with "file not found"). That's fine — proceed.

Run: `npm run test`
Expected: "No test files found." (Vitest exits 0 when no tests exist? Actually exits 1 by default; pass `--passWithNoTests` if it complains.)

**Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts src/manifest.ts .gitignore
git commit -m "chore: scaffold Vite + crxjs + Vitest project for Tabtastic!"
```

---

## Task 2: `browser.ts` Chrome API wrapper

A thin pass-through so tests can fake the Chrome surface. Only wraps the calls we'll actually make.

**Files:**
- Create: `src/lib/browser.ts`
- Create: `tests/lib/browser.test.ts`

**Step 1: Write the failing test**

`tests/lib/browser.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createBrowser, type BrowserApi } from '../../src/lib/browser';

describe('createBrowser', () => {
  it('returns an object exposing the expected API surface', () => {
    const api: BrowserApi = createBrowser();
    expect(typeof api.getWindow).toBe('function');
    expect(typeof api.queryTabs).toBe('function');
    expect(typeof api.queryTabGroups).toBe('function');
    expect(typeof api.createWindow).toBe('function');
    expect(typeof api.createTab).toBe('function');
    expect(typeof api.groupTabs).toBe('function');
    expect(typeof api.updateTabGroup).toBe('function');
    expect(typeof api.storageGet).toBe('function');
    expect(typeof api.storageSet).toBe('function');
  });
});
```

**Step 2: Run the test, expect failure**

Run: `npm test -- browser`
Expected: FAIL — module not found.

**Step 3: Implement `src/lib/browser.ts`**

```ts
export interface BrowserApi {
  getWindow(windowId: number): Promise<chrome.windows.Window>;
  queryTabs(query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
  queryTabGroups(query: chrome.tabGroups.QueryInfo): Promise<chrome.tabGroups.TabGroup[]>;
  createWindow(opts: chrome.windows.CreateData): Promise<chrome.windows.Window | undefined>;
  createTab(opts: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab>;
  groupTabs(opts: chrome.tabs.GroupOptions): Promise<number>;
  updateTabGroup(groupId: number, props: chrome.tabGroups.UpdateProperties): Promise<chrome.tabGroups.TabGroup>;
  storageGet<T = unknown>(key: string): Promise<T | undefined>;
  storageSet(key: string, value: unknown): Promise<void>;
}

export function createBrowser(): BrowserApi {
  return {
    getWindow: (id) => chrome.windows.get(id, { populate: true }),
    queryTabs: (q) => chrome.tabs.query(q),
    queryTabGroups: (q) => chrome.tabGroups.query(q),
    createWindow: (opts) => chrome.windows.create(opts),
    createTab: (opts) => chrome.tabs.create(opts),
    groupTabs: (opts) => chrome.tabs.group(opts),
    updateTabGroup: (id, props) => chrome.tabGroups.update(id, props),
    storageGet: async (key) => (await chrome.storage.local.get(key))[key],
    storageSet: (key, value) => chrome.storage.local.set({ [key]: value }),
  };
}
```

**Step 4: Run the test, expect pass**

Run: `npm test -- browser`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/browser.ts tests/lib/browser.test.ts
git commit -m "feat: add browser.ts wrapper around chrome.* APIs"
```

---

## Task 3: Data model types + storage layer

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/storage.ts`
- Create: `tests/lib/storage.test.ts`

**Step 1: Write `src/lib/types.ts`**

```ts
export type TabSnap = { url: string; title: string };

export type GroupSnap = {
  title: string;
  color: chrome.tabGroups.ColorEnum;
  collapsed: boolean;
  tabs: TabSnap[];
};

export type Snapshot = {
  id: string;
  label?: string;
  takenAt: number;
  windowName: string;
  groups: GroupSnap[];
  ungroupedTabs: TabSnap[];
};

export type AutoSlots = {
  hour: Snapshot | null;
  day: Snapshot | null;
  week: Snapshot | null;
  month: Snapshot | null;
};

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  autoSlots: AutoSlots;
  named: Snapshot[];
};

export type ProjectsRoot = { projects: Project[] };
```

**Step 2: Write the failing test for storage**

`tests/lib/storage.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createStorage } from '../../src/lib/storage';
import type { Project } from '../../src/lib/types';

function fakeBrowser() {
  const store = new Map<string, unknown>();
  return {
    storageGet: async <T>(key: string) => store.get(key) as T | undefined,
    storageSet: async (key: string, value: unknown) => { store.set(key, value); },
  };
}

describe('storage', () => {
  it('returns empty array when nothing stored', async () => {
    const s = createStorage(fakeBrowser() as never);
    expect(await s.listProjects()).toEqual([]);
  });

  it('round-trips a project', async () => {
    const s = createStorage(fakeBrowser() as never);
    const p: Project = {
      id: 'p1', name: 'Acme', createdAt: 1, autoSlots: { hour: null, day: null, week: null, month: null }, named: [],
    };
    await s.upsertProject(p);
    expect(await s.listProjects()).toEqual([p]);
    expect(await s.getProject('p1')).toEqual(p);
  });

  it('updates existing project on upsert', async () => {
    const s = createStorage(fakeBrowser() as never);
    const p: Project = { id: 'p1', name: 'Acme', createdAt: 1, autoSlots: { hour: null, day: null, week: null, month: null }, named: [] };
    await s.upsertProject(p);
    await s.upsertProject({ ...p, name: 'Acme Renamed' });
    const all = await s.listProjects();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('Acme Renamed');
  });

  it('deletes a project', async () => {
    const s = createStorage(fakeBrowser() as never);
    const p: Project = { id: 'p1', name: 'Acme', createdAt: 1, autoSlots: { hour: null, day: null, week: null, month: null }, named: [] };
    await s.upsertProject(p);
    await s.deleteProject('p1');
    expect(await s.listProjects()).toEqual([]);
  });
});
```

**Step 3: Run test, expect failure**

Run: `npm test -- storage`
Expected: FAIL — module not found.

**Step 4: Implement `src/lib/storage.ts`**

```ts
import type { BrowserApi } from './browser';
import type { Project, ProjectsRoot } from './types';

const KEY = 'projects';

export interface Storage {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  upsertProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
}

export function createStorage(browser: Pick<BrowserApi, 'storageGet' | 'storageSet'>): Storage {
  async function readAll(): Promise<Project[]> {
    return (await browser.storageGet<Project[]>(KEY)) ?? [];
  }
  async function writeAll(list: Project[]) {
    await browser.storageSet(KEY, list);
  }
  return {
    listProjects: readAll,
    async getProject(id) {
      return (await readAll()).find((p) => p.id === id);
    },
    async upsertProject(p) {
      const all = await readAll();
      const idx = all.findIndex((x) => x.id === p.id);
      if (idx >= 0) all[idx] = p; else all.push(p);
      await writeAll(all);
    },
    async deleteProject(id) {
      await writeAll((await readAll()).filter((p) => p.id !== id));
    },
  };
}
```

**Step 5: Run test, expect pass**

Run: `npm test -- storage`
Expected: PASS (4 tests).

**Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/storage.ts tests/lib/storage.test.ts
git commit -m "feat: add typed storage layer over chrome.storage.local"
```

---

## Task 4: Snapshot capture (window → Snapshot)

**Files:**
- Create: `src/lib/capture.ts`
- Create: `tests/lib/capture.test.ts`

**Step 1: Write the failing test**

`tests/lib/capture.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { captureSnapshot } from '../../src/lib/capture';

const fakeBrowser = (window: chrome.windows.Window, tabs: chrome.tabs.Tab[], groups: chrome.tabGroups.TabGroup[]) => ({
  getWindow: async () => window,
  queryTabs: async () => tabs,
  queryTabGroups: async () => groups,
});

describe('captureSnapshot', () => {
  it('captures groups in tab order with their tabs', async () => {
    const tabs = [
      { id: 1, windowId: 10, index: 0, groupId: 100, url: 'https://a.com', title: 'A' },
      { id: 2, windowId: 10, index: 1, groupId: 100, url: 'https://b.com', title: 'B' },
      { id: 3, windowId: 10, index: 2, groupId: 101, url: 'https://c.com', title: 'C' },
    ] as chrome.tabs.Tab[];
    const groups = [
      { id: 100, title: '🚀 frontend', color: 'blue', collapsed: false, windowId: 10 },
      { id: 101, title: '🚀 backend', color: 'green', collapsed: true, windowId: 10 },
    ] as chrome.tabGroups.TabGroup[];
    const win = { id: 10, title: 'Acme' } as chrome.windows.Window;

    const snap = await captureSnapshot(fakeBrowser(win, tabs, groups) as never, 10, () => 'fixed-id', () => 1700);

    expect(snap).toEqual({
      id: 'fixed-id',
      takenAt: 1700,
      windowName: 'Acme',
      groups: [
        { title: '🚀 frontend', color: 'blue', collapsed: false, tabs: [{ url: 'https://a.com', title: 'A' }, { url: 'https://b.com', title: 'B' }] },
        { title: '🚀 backend', color: 'green', collapsed: true, tabs: [{ url: 'https://c.com', title: 'C' }] },
      ],
      ungroupedTabs: [],
    });
  });

  it('puts ungrouped tabs (groupId -1) in ungroupedTabs preserving order', async () => {
    const tabs = [
      { id: 1, windowId: 10, index: 0, groupId: -1, url: 'https://a.com', title: 'A' },
      { id: 2, windowId: 10, index: 1, groupId: -1, url: 'https://b.com', title: 'B' },
    ] as chrome.tabs.Tab[];
    const win = { id: 10, title: 'W' } as chrome.windows.Window;

    const snap = await captureSnapshot(fakeBrowser(win, tabs, []) as never, 10, () => 'id', () => 0);

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
    ] as chrome.tabs.Tab[];
    const groups = [
      { id: 100, title: 'second', color: 'red', collapsed: false, windowId: 10 },
      { id: 200, title: 'first',  color: 'blue', collapsed: false, windowId: 10 },
    ] as chrome.tabGroups.TabGroup[];
    const win = { id: 10, title: 'W' } as chrome.windows.Window;

    const snap = await captureSnapshot(fakeBrowser(win, tabs, groups) as never, 10, () => 'id', () => 0);
    expect(snap.groups.map((g) => g.title)).toEqual(['first', 'second']);
  });
});
```

**Step 2: Run test, expect failure**

Run: `npm test -- capture`
Expected: FAIL.

**Step 3: Implement `src/lib/capture.ts`**

```ts
import type { BrowserApi } from './browser';
import type { Snapshot, GroupSnap, TabSnap } from './types';

type Deps = Pick<BrowserApi, 'getWindow' | 'queryTabs' | 'queryTabGroups'>;

export async function captureSnapshot(
  browser: Deps,
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
    if (t.groupId === -1 || t.groupId === undefined) {
      ungroupedTabs.push({ url: t.url ?? '', title: t.title ?? '' });
      continue;
    }
    if (!tabsByGroup.has(t.groupId)) {
      tabsByGroup.set(t.groupId, []);
      firstIndexOfGroup.set(t.groupId, t.index);
    }
    tabsByGroup.get(t.groupId)!.push(t);
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
        color: g.color,
        collapsed: g.collapsed,
        tabs: (tabsByGroup.get(gid) ?? []).map((t) => ({ url: t.url ?? '', title: t.title ?? '' })),
      } satisfies GroupSnap;
    })
    .filter((x): x is GroupSnap => x !== null);

  return {
    id: newId(),
    takenAt: now(),
    windowName: win.title ?? '',
    groups: groupSnaps,
    ungroupedTabs,
  };
}
```

**Step 4: Run test, expect pass**

Run: `npm test -- capture`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/lib/capture.ts tests/lib/capture.test.ts
git commit -m "feat: capture window state into a Snapshot"
```

---

## Task 5: Retention rotation (4-slot Time Machine)

This is the most logic-heavy pure function. Test thoroughly.

**Files:**
- Create: `src/lib/retention.ts`
- Create: `tests/lib/retention.test.ts`

**Step 1: Write the failing tests**

`tests/lib/retention.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { rotate } from '../../src/lib/retention';
import type { AutoSlots, Snapshot } from '../../src/lib/types';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const empty = (): AutoSlots => ({ hour: null, day: null, week: null, month: null });
const snap = (id: string, takenAt: number): Snapshot => ({
  id, takenAt, windowName: 'w', groups: [], ungroupedTabs: [],
});

describe('rotate', () => {
  it('puts the first snapshot in hour', () => {
    const out = rotate(empty(), snap('a', 1000), 1000);
    expect(out).toEqual({ hour: snap('a', 1000), day: null, week: null, month: null });
  });

  it('replaces hour with newer snapshot when prior hour is still <1h old', () => {
    const slots = { ...empty(), hour: snap('a', 0) };
    const out = rotate(slots, snap('b', 30 * 60 * 1000), 30 * 60 * 1000);
    expect(out.hour).toEqual(snap('b', 30 * 60 * 1000));
    expect(out.day).toBeNull();
  });

  it('promotes hour to day when hour is >=1h old at save time', () => {
    const slots = { ...empty(), hour: snap('a', 0) };
    const now = HOUR;
    const out = rotate(slots, snap('b', now), now);
    expect(out.hour).toEqual(snap('b', now));
    expect(out.day).toEqual(snap('a', 0));
  });

  it('chains hour → day → week → month when all are aged', () => {
    const slots: AutoSlots = {
      hour:  snap('h', 0),
      day:  snap('d', -DAY),
      week: snap('w', -WEEK),
      month: null,
    };
    // Now is far enough that h is aged past 7d (so will hit month after chained promotions).
    const now = 31 * DAY;
    const out = rotate(slots, snap('new', now), now);
    expect(out.hour).toEqual(snap('new', now));
    // Promotions: h aged 31d → goes via day(>=1h)→week(>=1d)→month(>=7d).
    // Original day,d (age 32d) was displaced and would have aged out (>30d).
    // Original week,w (age 38d) was displaced and aged out (>30d).
    // So month should hold h.
    expect(out.month).toEqual(snap('h', 0));
    expect(out.day).toBeNull();
    expect(out.week).toBeNull();
  });

  it('drops snapshots aged past 1 month', () => {
    const slots: AutoSlots = {
      hour: null, day: null, week: null,
      month: snap('old', 0),
    };
    const now = 31 * DAY;
    const out = rotate(slots, snap('new', now), now);
    expect(out.month).toBeNull(); // old was dropped (no incoming promotion to fill it)
    expect(out.hour).toEqual(snap('new', now));
  });

  it('keeps month when within 30 days', () => {
    const slots: AutoSlots = {
      hour: null, day: null, week: null,
      month: snap('m', 0),
    };
    const now = 20 * DAY;
    const out = rotate(slots, snap('new', now), now);
    expect(out.month).toEqual(snap('m', 0));
  });

  it('does not double-promote a fresh snapshot in one rotation', () => {
    // The new snapshot only enters `hour` and is never moved further in the same call.
    const out = rotate(empty(), snap('new', 1000), 1000);
    expect(out.hour).toEqual(snap('new', 1000));
    expect(out.day).toBeNull();
  });
});
```

**Step 2: Run tests, expect failure**

Run: `npm test -- retention`
Expected: FAIL.

**Step 3: Implement `src/lib/retention.ts`**

```ts
import type { AutoSlots, Snapshot } from './types';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

export function rotate(slots: AutoSlots, fresh: Snapshot, now: number): AutoSlots {
  const next: AutoSlots = { ...slots };

  // Step 1: fresh always goes into hour. Whatever was there is displaced.
  let displaced: Snapshot | null = next.hour;
  next.hour = fresh;

  // Step 2: try to put displaced into day if it is now >=1h old.
  if (displaced && now - displaced.takenAt >= HOUR) {
    const fromDay = next.day;
    next.day = displaced;
    displaced = fromDay;

    // Step 3: try to put displaced (originally from day) into week if >=1d old.
    if (displaced && now - displaced.takenAt >= DAY) {
      const fromWeek = next.week;
      next.week = displaced;
      displaced = fromWeek;

      // Step 4: try to put displaced (originally from week) into month if >=7d old.
      if (displaced && now - displaced.takenAt >= WEEK) {
        next.month = displaced;
      }
    }
  }

  // Drop month occupant if older than 30 days.
  if (next.month && now - next.month.takenAt > MONTH) {
    next.month = null;
  }

  return next;
}
```

**Step 4: Run tests, expect pass**

Run: `npm test -- retention`
Expected: PASS (7 tests).

**Step 5: Commit**

```bash
git add src/lib/retention.ts tests/lib/retention.test.ts
git commit -m "feat: 4-slot Time Machine retention rotation"
```

---

## Task 6: Per-window debouncer

**Files:**
- Create: `src/lib/debouncer.ts`
- Create: `tests/lib/debouncer.test.ts`

**Step 1: Write the failing tests**

`tests/lib/debouncer.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebouncer } from '../../src/lib/debouncer';

describe('debouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once after the delay if scheduled once', () => {
    const fn = vi.fn();
    const d = createDebouncer(1000);
    d.schedule('w1', fn);
    vi.advanceTimersByTime(999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('coalesces rapid scheduling into one fire', () => {
    const fn = vi.fn();
    const d = createDebouncer(1000);
    d.schedule('w1', fn);
    vi.advanceTimersByTime(500);
    d.schedule('w1', fn);
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('flushNow fires immediately and cancels the pending timer', () => {
    const fn = vi.fn();
    const d = createDebouncer(1000);
    d.schedule('w1', fn);
    d.flushNow('w1');
    expect(fn).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('keeps schedules per-key separate', () => {
    const a = vi.fn(); const b = vi.fn();
    const d = createDebouncer(1000);
    d.schedule('w1', a);
    d.schedule('w2', b);
    d.flushNow('w1');
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(b).toHaveBeenCalledOnce();
  });
});
```

**Step 2: Run tests, expect failure.**

Run: `npm test -- debouncer`

**Step 3: Implement `src/lib/debouncer.ts`**

```ts
export interface Debouncer {
  schedule(key: string, fn: () => void): void;
  flushNow(key: string): void;
  cancel(key: string): void;
}

export function createDebouncer(delayMs: number): Debouncer {
  const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; fn: () => void }>();
  return {
    schedule(key, fn) {
      const prev = pending.get(key);
      if (prev) clearTimeout(prev.timer);
      const timer = setTimeout(() => {
        pending.delete(key);
        fn();
      }, delayMs);
      pending.set(key, { timer, fn });
    },
    flushNow(key) {
      const entry = pending.get(key);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(key);
      entry.fn();
    },
    cancel(key) {
      const entry = pending.get(key);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(key);
    },
  };
}
```

**Step 4: Run tests, expect pass.**

**Step 5: Commit**

```bash
git add src/lib/debouncer.ts tests/lib/debouncer.test.ts
git commit -m "feat: per-key debouncer for auto-save coalescing"
```

---

## Task 7: Binding map (`windowId ↔ projectId`)

**Files:**
- Create: `src/lib/bindings.ts`
- Create: `tests/lib/bindings.test.ts`

**Step 1: Write the failing tests**

`tests/lib/bindings.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createBindings } from '../../src/lib/bindings';
import type { Project } from '../../src/lib/types';

const proj = (id: string, name: string): Project => ({
  id, name, createdAt: 0,
  autoSlots: { hour: null, day: null, week: null, month: null },
  named: [],
});

describe('bindings', () => {
  it('binds and looks up by windowId', () => {
    const b = createBindings();
    b.bind(10, 'p1');
    expect(b.projectIdFor(10)).toBe('p1');
    expect(b.windowIdFor('p1')).toBe(10);
  });

  it('unbinds on demand', () => {
    const b = createBindings();
    b.bind(10, 'p1');
    b.unbindWindow(10);
    expect(b.projectIdFor(10)).toBeUndefined();
    expect(b.windowIdFor('p1')).toBeUndefined();
  });

  it('rebuilds by matching window titles to project names', () => {
    const b = createBindings();
    const projects = [proj('p1', 'Acme'), proj('p2', 'Globex')];
    const windows = [
      { id: 1, title: 'Acme' } as chrome.windows.Window,
      { id: 2, title: 'Unrelated' } as chrome.windows.Window,
      { id: 3, title: 'Globex' } as chrome.windows.Window,
    ];
    b.rebuild(windows, projects);
    expect(b.projectIdFor(1)).toBe('p1');
    expect(b.projectIdFor(2)).toBeUndefined();
    expect(b.projectIdFor(3)).toBe('p2');
  });

  it('first window wins when two windows share the same title', () => {
    const b = createBindings();
    const projects = [proj('p1', 'Acme')];
    const windows = [
      { id: 1, title: 'Acme' } as chrome.windows.Window,
      { id: 2, title: 'Acme' } as chrome.windows.Window,
    ];
    b.rebuild(windows, projects);
    expect(b.projectIdFor(1)).toBe('p1');
    expect(b.projectIdFor(2)).toBeUndefined();
    expect(b.windowIdFor('p1')).toBe(1);
  });
});
```

**Step 2: Run tests, expect failure.**

**Step 3: Implement `src/lib/bindings.ts`**

```ts
import type { Project } from './types';

export interface Bindings {
  bind(windowId: number, projectId: string): void;
  unbindWindow(windowId: number): void;
  unbindProject(projectId: string): void;
  projectIdFor(windowId: number): string | undefined;
  windowIdFor(projectId: string): number | undefined;
  rebuild(windows: chrome.windows.Window[], projects: Project[]): void;
}

export function createBindings(): Bindings {
  const w2p = new Map<number, string>();
  const p2w = new Map<string, number>();

  function bind(windowId: number, projectId: string) {
    if (p2w.has(projectId)) return; // first-wins
    w2p.set(windowId, projectId);
    p2w.set(projectId, windowId);
  }
  function unbindWindow(windowId: number) {
    const pid = w2p.get(windowId);
    if (!pid) return;
    w2p.delete(windowId);
    p2w.delete(pid);
  }
  function unbindProject(projectId: string) {
    const wid = p2w.get(projectId);
    if (wid === undefined) return;
    p2w.delete(projectId);
    w2p.delete(wid);
  }

  return {
    bind, unbindWindow, unbindProject,
    projectIdFor: (id) => w2p.get(id),
    windowIdFor: (id) => p2w.get(id),
    rebuild(windows, projects) {
      w2p.clear(); p2w.clear();
      const byName = new Map<string, Project>();
      for (const p of projects) byName.set(p.name, p);
      for (const w of windows) {
        const title = w.title ?? '';
        const p = byName.get(title);
        if (!p) continue;
        if (p2w.has(p.id)) continue;
        if (w.id === undefined) continue;
        bind(w.id, p.id);
      }
    },
  };
}
```

**Step 4: Run tests, expect pass.**

**Step 5: Commit**

```bash
git add src/lib/bindings.ts tests/lib/bindings.test.ts
git commit -m "feat: in-memory windowId↔projectId binding map with rebuild"
```

---

## Task 8: Auto-save engine (composition)

Wire capture + retention + storage + debouncer + bindings into a single `autoSaveTick(windowId)` function. This is the unit the listener layer will call. Pure-ish — only depends on the wrapper, not raw `chrome.*`.

**Files:**
- Create: `src/lib/autosave.ts`
- Create: `tests/lib/autosave.test.ts`

**Step 1: Write the failing test**

`tests/lib/autosave.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createAutoSave } from '../../src/lib/autosave';
import type { Project } from '../../src/lib/types';

function setup(initial: Project[]) {
  const store = new Map<string, unknown>([['projects', initial]]);
  const browser = {
    storageGet: async <T>(k: string) => store.get(k) as T,
    storageSet: async (k: string, v: unknown) => { store.set(k, v); },
    getWindow: async (_id: number) => ({ id: 10, title: 'Acme' }) as chrome.windows.Window,
    queryTabs: async () => [{ id: 1, windowId: 10, index: 0, groupId: -1, url: 'https://x.com', title: 'X' }] as chrome.tabs.Tab[],
    queryTabGroups: async () => [] as chrome.tabGroups.TabGroup[],
  };
  return { store, browser };
}

const proj = (id: string, name: string): Project => ({
  id, name, createdAt: 0,
  autoSlots: { hour: null, day: null, week: null, month: null },
  named: [],
});

describe('autosave.tick', () => {
  it('writes a snapshot into the project hour slot', async () => {
    const { store, browser } = setup([proj('p1', 'Acme')]);
    const auto = createAutoSave(browser as never, () => 'sid', () => 5000);
    await auto.tick(10, 'p1');
    const projects = store.get('projects') as Project[];
    expect(projects[0]!.autoSlots.hour?.id).toBe('sid');
    expect(projects[0]!.autoSlots.hour?.takenAt).toBe(5000);
  });

  it('updates project name from the window title if changed', async () => {
    const { store, browser } = setup([proj('p1', 'Old Name')]);
    const auto = createAutoSave(browser as never, () => 'sid', () => 0);
    await auto.tick(10, 'p1');
    const projects = store.get('projects') as Project[];
    expect(projects[0]!.name).toBe('Acme');
  });

  it('does nothing if project not found', async () => {
    const { store, browser } = setup([]);
    const auto = createAutoSave(browser as never, () => 'sid', () => 0);
    await auto.tick(10, 'p1');
    expect(store.get('projects')).toEqual([]);
  });
});
```

**Step 2: Run test, expect failure.**

**Step 3: Implement `src/lib/autosave.ts`**

```ts
import type { BrowserApi } from './browser';
import { captureSnapshot } from './capture';
import { rotate } from './retention';
import { createStorage } from './storage';

export function createAutoSave(
  browser: BrowserApi,
  newId: () => string,
  now: () => number,
) {
  const storage = createStorage(browser);
  return {
    async tick(windowId: number, projectId: string) {
      const project = await storage.getProject(projectId);
      if (!project) return;
      const snap = await captureSnapshot(browser, windowId, newId, now);
      const updated = {
        ...project,
        name: snap.windowName || project.name,
        autoSlots: rotate(project.autoSlots, snap, now()),
      };
      await storage.upsertProject(updated);
    },
  };
}
```

**Step 4: Run test, expect pass.**

**Step 5: Commit**

```bash
git add src/lib/autosave.ts tests/lib/autosave.test.ts
git commit -m "feat: compose capture+retention+storage into autosave tick"
```

---

## Task 9: Restore engine

**Files:**
- Create: `src/lib/restore.ts`
- Create: `tests/lib/restore.test.ts`

**Step 1: Write the failing test**

`tests/lib/restore.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { restoreSnapshot } from '../../src/lib/restore';
import type { Snapshot } from '../../src/lib/types';

function fakeBrowser() {
  const created: { kind: string; payload: unknown }[] = [];
  let nextWindowId = 100;
  let nextTabId = 1;
  let nextGroupId = 1000;
  const browser = {
    createWindow: async (opts: chrome.windows.CreateData) => {
      const id = nextWindowId++;
      created.push({ kind: 'window', payload: { id, opts } });
      return { id, tabs: [{ id: nextTabId++, url: opts.url }] } as chrome.windows.Window;
    },
    createTab: async (opts: chrome.tabs.CreateProperties) => {
      const id = nextTabId++;
      created.push({ kind: 'tab', payload: { id, opts } });
      return { id, ...opts } as chrome.tabs.Tab;
    },
    groupTabs: async (opts: chrome.tabs.GroupOptions) => {
      const gid = nextGroupId++;
      created.push({ kind: 'group', payload: { gid, opts } });
      return gid;
    },
    updateTabGroup: async (id: number, props: chrome.tabGroups.UpdateProperties) => {
      created.push({ kind: 'updateGroup', payload: { id, props } });
      return { id, ...props } as chrome.tabGroups.TabGroup;
    },
  };
  return { browser, created };
}

const snap = (): Snapshot => ({
  id: 's', takenAt: 0, windowName: 'Acme',
  groups: [
    { title: '🚀 frontend', color: 'blue', collapsed: false, tabs: [{ url: 'https://a.com', title: 'A' }, { url: 'https://b.com', title: 'B' }] },
    { title: '🚀 backend',  color: 'green', collapsed: true,  tabs: [{ url: 'https://c.com', title: 'C' }] },
  ],
  ungroupedTabs: [{ url: 'https://misc.com', title: 'Misc' }],
});

describe('restoreSnapshot', () => {
  it('creates a window with the first URL, recreates groups in order, then ungrouped tabs', async () => {
    const { browser, created } = fakeBrowser();
    const result = await restoreSnapshot(browser as never, snap());

    expect(result.windowId).toBeTypeOf('number');
    // Window created first with first group's first tab as seed.
    expect(created[0]!.kind).toBe('window');
    expect((created[0]!.payload as { opts: chrome.windows.CreateData }).opts.url).toBe('https://a.com');
    // No restore failures expected for normal URLs.
    expect(result.failures).toEqual([]);
    // 2 groups created with title/color set, 3 additional tabs created (b, c, misc), seed already accounts for `a`.
    const groupCalls = created.filter((c) => c.kind === 'group');
    expect(groupCalls).toHaveLength(2);
    const updateGroupCalls = created.filter((c) => c.kind === 'updateGroup');
    expect(updateGroupCalls.map((u) => (u.payload as { props: { title?: string } }).props.title))
      .toEqual(['🚀 frontend', '🚀 backend']);
  });

  it('records failures for chrome:// URLs', async () => {
    const { browser } = fakeBrowser();
    const overridden = {
      ...browser,
      createTab: async (opts: chrome.tabs.CreateProperties) => {
        if (opts.url?.startsWith('chrome://')) throw new Error('blocked');
        return browser.createTab(opts);
      },
    };
    const s: Snapshot = { ...snap(), groups: [
      { title: 'g', color: 'red', collapsed: false, tabs: [{ url: 'https://ok.com', title: 'Ok' }, { url: 'chrome://settings', title: 'Settings' }] },
    ], ungroupedTabs: [] };
    const result = await restoreSnapshot(overridden as never, s);
    expect(result.failures.map((f) => f.url)).toEqual(['chrome://settings']);
  });
});
```

**Step 2: Run test, expect failure.**

**Step 3: Implement `src/lib/restore.ts`**

```ts
import type { BrowserApi } from './browser';
import type { Snapshot, TabSnap } from './types';

type Deps = Pick<BrowserApi, 'createWindow' | 'createTab' | 'groupTabs' | 'updateTabGroup'>;

export type RestoreFailure = { url: string; reason: string };
export type RestoreResult = { windowId: number; failures: RestoreFailure[] };

export async function restoreSnapshot(browser: Deps, snap: Snapshot): Promise<RestoreResult> {
  const failures: RestoreFailure[] = [];
  const seedUrl = snap.groups[0]?.tabs[0]?.url ?? snap.ungroupedTabs[0]?.url ?? 'about:blank';
  const win = await browser.createWindow({ url: seedUrl, focused: true });
  const windowId = win?.id;
  if (windowId === undefined) throw new Error('createWindow returned no id');

  const seedTabId = (win?.tabs?.[0]?.id) ?? -1;
  let consumedSeed = false;

  async function recreateTab(t: TabSnap): Promise<number | null> {
    if (!consumedSeed && t.url === seedUrl && seedTabId >= 0) {
      consumedSeed = true;
      return seedTabId;
    }
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
    const groupId = await browser.groupTabs({ tabIds, createProperties: { windowId } });
    await browser.updateTabGroup(groupId, {
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
    });
  }

  for (const t of snap.ungroupedTabs) {
    await recreateTab(t);
  }

  return { windowId, failures };
}
```

**Step 4: Run test, expect pass.**

**Step 5: Commit**

```bash
git add src/lib/restore.ts tests/lib/restore.test.ts
git commit -m "feat: restore a Snapshot into a fresh window"
```

---

## Task 10: Service worker (background)

Wire all listeners. Now we step into Chrome-only territory; minimal logic, mostly delegation. No unit test — covered by manual smoke.

**Files:**
- Create: `src/background/index.ts`

**Step 1: Implement**

```ts
import { createBrowser } from '../lib/browser';
import { createStorage } from '../lib/storage';
import { createBindings } from '../lib/bindings';
import { createDebouncer } from '../lib/debouncer';
import { createAutoSave } from '../lib/autosave';
import { restoreSnapshot } from '../lib/restore';
import type { Snapshot } from '../lib/types';

const browser = createBrowser();
const storage = createStorage(browser);
const bindings = createBindings();
const debouncer = createDebouncer(30_000);
const autoSave = createAutoSave(browser, () => crypto.randomUUID(), () => Date.now());

async function rebuildBindings() {
  const [windows, projects] = await Promise.all([
    chrome.windows.getAll({ populate: false }),
    storage.listProjects(),
  ]);
  bindings.rebuild(windows, projects);
}

function scheduleSave(windowId: number) {
  const pid = bindings.projectIdFor(windowId);
  if (!pid) return;
  debouncer.schedule(String(windowId), () => { void autoSave.tick(windowId, pid); });
}

chrome.runtime.onInstalled.addListener(() => { void rebuildBindings(); });
chrome.runtime.onStartup.addListener(() => { void rebuildBindings(); });

chrome.tabs.onCreated.addListener((tab) => { if (tab.windowId !== undefined) scheduleSave(tab.windowId); });
chrome.tabs.onRemoved.addListener((_id, info) => scheduleSave(info.windowId));
chrome.tabs.onUpdated.addListener((_id, _info, tab) => { if (tab.windowId !== undefined) scheduleSave(tab.windowId); });
chrome.tabs.onMoved.addListener((_id, info) => scheduleSave(info.windowId));
chrome.tabs.onAttached.addListener((_id, info) => scheduleSave(info.newWindowId));
chrome.tabs.onDetached.addListener((_id, info) => scheduleSave(info.oldWindowId));

chrome.tabGroups.onCreated.addListener((g) => scheduleSave(g.windowId));
chrome.tabGroups.onUpdated.addListener((g) => scheduleSave(g.windowId));
chrome.tabGroups.onRemoved.addListener((g) => scheduleSave(g.windowId));
chrome.tabGroups.onMoved.addListener((g) => scheduleSave(g.windowId));

chrome.windows.onFocusChanged.addListener((focusedId) => {
  if (focusedId === chrome.windows.WINDOW_ID_NONE) {
    for (const wid of bindings.allBoundWindows?.() ?? []) {
      debouncer.flushNow(String(wid));
    }
    return;
  }
  for (const wid of bindings.allBoundWindows?.() ?? []) {
    if (wid !== focusedId) debouncer.flushNow(String(wid));
  }
});

chrome.windows.onRemoved.addListener((wid) => {
  debouncer.cancel(String(wid));
  bindings.unbindWindow(wid);
});

// Message contract for popup/options.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'getCurrentWindowProjectId') {
        const w = await chrome.windows.getLastFocused();
        sendResponse({ ok: true, projectId: w.id !== undefined ? bindings.projectIdFor(w.id) : undefined, windowId: w.id, windowTitle: w.title });
      } else if (msg.type === 'saveAsProject') {
        const id = crypto.randomUUID();
        const win = await chrome.windows.get(msg.windowId, { populate: false });
        const project = {
          id,
          name: msg.name || win.title || 'Untitled',
          createdAt: Date.now(),
          autoSlots: { hour: null, day: null, week: null, month: null },
          named: [],
        };
        await storage.upsertProject(project);
        bindings.bind(msg.windowId, id);
        await autoSave.tick(msg.windowId, id);
        sendResponse({ ok: true, projectId: id });
      } else if (msg.type === 'saveNamedSnapshot') {
        const project = await storage.getProject(msg.projectId);
        if (!project) return sendResponse({ ok: false, error: 'project not found' });
        const wid = bindings.windowIdFor(msg.projectId);
        if (wid === undefined) return sendResponse({ ok: false, error: 'window not bound' });
        const { captureSnapshot } = await import('../lib/capture');
        const snap = await captureSnapshot(browser, wid, () => crypto.randomUUID(), () => Date.now());
        snap.label = msg.label;
        project.named.unshift(snap);
        await storage.upsertProject(project);
        sendResponse({ ok: true });
      } else if (msg.type === 'restoreSnapshot') {
        const project = await storage.getProject(msg.projectId);
        if (!project) return sendResponse({ ok: false, error: 'project not found' });
        const all: Snapshot[] = [
          ...project.named,
          ...(['hour','day','week','month'] as const).map(k => project.autoSlots[k]).filter((s): s is Snapshot => !!s),
        ];
        const snap = all.find(s => s.id === msg.snapshotId);
        if (!snap) return sendResponse({ ok: false, error: 'snapshot not found' });
        const result = await restoreSnapshot(browser, snap);
        bindings.bind(result.windowId, project.id);
        sendResponse({ ok: true, ...result });
      } else if (msg.type === 'deleteSnapshot') {
        const project = await storage.getProject(msg.projectId);
        if (!project) return sendResponse({ ok: false });
        project.named = project.named.filter(s => s.id !== msg.snapshotId);
        await storage.upsertProject(project);
        sendResponse({ ok: true });
      } else if (msg.type === 'listProjects') {
        sendResponse({ ok: true, projects: await storage.listProjects() });
      } else if (msg.type === 'deleteProject') {
        await storage.deleteProject(msg.projectId);
        bindings.unbindProject(msg.projectId);
        sendResponse({ ok: true });
      } else if (msg.type === 'renameProject') {
        const p = await storage.getProject(msg.projectId);
        if (!p) return sendResponse({ ok: false });
        p.name = msg.name;
        await storage.upsertProject(p);
        sendResponse({ ok: true });
      } else if (msg.type === 'exportAll') {
        sendResponse({ ok: true, data: { projects: await storage.listProjects() } });
      } else if (msg.type === 'importAll') {
        const incoming: { projects: typeof project[] } = msg.data;
        const existing = await storage.listProjects();
        const byId = new Map(existing.map(p => [p.id, p]));
        for (const p of incoming.projects) {
          if (byId.has(p.id) && msg.strategy === 'skip') continue;
          if (byId.has(p.id) && msg.strategy === 'rename') p.name = `${p.name} (imported)`;
          await storage.upsertProject(p);
        }
        sendResponse({ ok: true });
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error).message });
    }
  })();
  return true; // async
});
```

**Step 2: Update `bindings.ts` to expose `allBoundWindows`**

Add to the `Bindings` interface and implementation:
```ts
allBoundWindows(): number[];
// in createBindings:
allBoundWindows: () => [...w2p.keys()],
```
Add a test for it in `bindings.test.ts`:
```ts
it('lists all bound windowIds', () => {
  const b = createBindings();
  b.bind(1, 'p1'); b.bind(2, 'p2');
  expect(b.allBoundWindows().sort()).toEqual([1, 2]);
});
```

**Step 3: Run all tests**

Run: `npm test`
Expected: all pass.

**Step 4: Build to confirm Vite bundles cleanly**

Run: `npm run build`
Expected: `dist/` produced with no errors.

**Step 5: Commit**

```bash
git add src/background/index.ts src/lib/bindings.ts tests/lib/bindings.test.ts
git commit -m "feat: service worker wiring (listeners, debouncer, message handlers)"
```

---

## Task 11: Popup UI — current-window view

**Files:**
- Create: `src/popup/index.html`
- Create: `src/popup/index.ts`
- Create: `src/popup/styles.css`

**Step 1: HTML**

`src/popup/index.html`:
```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="./styles.css" />
    <title>Tabtastic!</title>
  </head>
  <body>
    <div id="root">Loading…</div>
    <script type="module" src="./index.ts"></script>
  </body>
</html>
```

**Step 2: CSS (minimal, no framework)**

`src/popup/styles.css`:
```css
:root { font-family: -apple-system, system-ui, sans-serif; font-size: 13px; }
body { margin: 0; min-width: 320px; max-width: 380px; }
#root { padding: 12px; }
h1 { font-size: 14px; margin: 0 0 8px; }
.section { margin: 12px 0 4px; font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: 0.05em; }
.row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.row .meta { flex: 1; color: #555; }
.row button { font-size: 11px; padding: 2px 8px; }
.primary { width: 100%; padding: 8px; margin: 8px 0; }
.empty { color: #aaa; font-style: italic; padding: 4px 0; }
input[type="text"] { width: 100%; box-sizing: border-box; padding: 6px; }
```

**Step 3: Logic**

`src/popup/index.ts`:
```ts
import type { Project, Snapshot } from '../lib/types';

const send = <T>(msg: unknown): Promise<T> =>
  new Promise((res) => chrome.runtime.sendMessage(msg, res));

function fmtAge(t: number): string {
  const ms = Date.now() - t;
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

async function render() {
  const root = document.getElementById('root')!;
  const ctx = await send<{ ok: true; projectId?: string; windowId: number; windowTitle: string }>({ type: 'getCurrentWindowProjectId' });

  if (!ctx.projectId) {
    root.innerHTML = `
      <h1>Tabtastic!</h1>
      <div class="section">No project bound to this window</div>
      <input type="text" id="name" placeholder="Project name" />
      <button class="primary" id="save">Save this window as a project</button>
      <p style="margin-top:12px"><a href="#" id="opts">Manage all projects →</a></p>
    `;
    (document.getElementById('name') as HTMLInputElement).value = ctx.windowTitle ?? '';
    document.getElementById('save')!.addEventListener('click', async () => {
      const name = (document.getElementById('name') as HTMLInputElement).value.trim();
      const r = await send<{ ok: boolean }>({ type: 'saveAsProject', windowId: ctx.windowId, name });
      if (r.ok) render();
    });
    document.getElementById('opts')!.addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
    return;
  }

  const list = await send<{ ok: true; projects: Project[] }>({ type: 'listProjects' });
  const project = list.projects.find((p) => p.id === ctx.projectId)!;
  const auto = (['hour','day','week','month'] as const)
    .map((k) => ({ slot: k, snap: project.autoSlots[k] }))
    .filter((s) => s.snap !== null) as { slot: string; snap: Snapshot }[];

  root.innerHTML = `
    <h1>${escapeHtml(project.name)} <a href="#" id="opts" style="float:right;font-weight:normal;font-size:12px">⚙</a></h1>
    <div class="meta">Window: "${escapeHtml(ctx.windowTitle ?? '')}"</div>
    <button class="primary" id="snap">+ Save Named Snapshot…</button>
    <div class="section">Auto</div>
    ${auto.length === 0 ? '<div class="empty">No auto-saves yet</div>' : ''}
    ${auto.map(({ snap }) => `
      <div class="row"><span class="meta">${fmtAge(snap.takenAt)}</span><button data-restore="${snap.id}">restore</button></div>
    `).join('')}
    <div class="section">Named</div>
    ${project.named.length === 0 ? '<div class="empty">No named snapshots</div>' : ''}
    ${project.named.map((s) => `
      <div class="row">
        <span class="meta">${escapeHtml(s.label ?? '(unnamed)')}</span>
        <button data-restore="${s.id}">restore</button>
        <button data-delete="${s.id}">×</button>
      </div>
    `).join('')}
  `;

  document.getElementById('opts')!.addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
  document.getElementById('snap')!.addEventListener('click', async () => {
    const label = prompt('Snapshot name', 'clean baseline');
    if (!label) return;
    await send({ type: 'saveNamedSnapshot', projectId: project.id, label });
    render();
  });
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-restore]')) {
    btn.addEventListener('click', async () => {
      await send({ type: 'restoreSnapshot', projectId: project.id, snapshotId: btn.dataset.restore });
    });
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-delete]')) {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this snapshot?')) return;
      await send({ type: 'deleteSnapshot', projectId: project.id, snapshotId: btn.dataset.delete });
      render();
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

render();
```

**Step 4: Manual smoke**

Run: `npm run build`
Then in Chrome: `chrome://extensions` → Developer mode → Load unpacked → select `dist/`.
Click the Tabtastic! icon on a window → should show "Save this window as a project" form. Save it. Reopen popup → should show the project with its snapshot list.

**Step 5: Commit**

```bash
git add src/popup/
git commit -m "feat: popup UI for current-window project"
```

---

## Task 12: Options page — all-projects manager

**Files:**
- Create: `src/options/index.html`
- Create: `src/options/index.ts`
- Create: `src/options/styles.css`

**Step 1: HTML + CSS** (skeleton: header, table, file-input for import)

`src/options/index.html`:
```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="./styles.css" />
    <title>Tabtastic! — Projects</title>
  </head>
  <body>
    <header>
      <h1>Tabtastic!</h1>
      <div class="actions">
        <button id="export">Export all</button>
        <input type="file" id="importFile" accept="application/json" hidden />
        <button id="importBtn">Import…</button>
      </div>
    </header>
    <main id="list"></main>
    <script type="module" src="./index.ts"></script>
  </body>
</html>
```

`src/options/styles.css`:
```css
body { font-family: -apple-system, system-ui, sans-serif; max-width: 900px; margin: 24px auto; padding: 0 16px; }
header { display: flex; align-items: center; justify-content: space-between; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid #eee; }
.actions button { margin-left: 8px; }
button.danger { color: #b00; }
```

**Step 2: Logic**

`src/options/index.ts`:
```ts
import type { Project } from '../lib/types';

const send = <T>(msg: unknown): Promise<T> =>
  new Promise((res) => chrome.runtime.sendMessage(msg, res));

async function render() {
  const r = await send<{ ok: true; projects: Project[] }>({ type: 'listProjects' });
  const list = document.getElementById('list')!;
  if (r.projects.length === 0) {
    list.innerHTML = '<p>No projects yet. Open a window and save it from the popup.</p>';
    return;
  }
  list.innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Auto</th><th>Named</th><th>Last save</th><th></th></tr></thead>
      <tbody>
        ${r.projects.map((p) => {
          const autoCount = (['hour','day','week','month'] as const).filter(k => p.autoSlots[k]).length;
          const lastTimes = [
            ...(['hour','day','week','month'] as const).map(k => p.autoSlots[k]?.takenAt ?? 0),
            ...p.named.map(s => s.takenAt),
          ];
          const last = Math.max(0, ...lastTimes);
          return `
            <tr data-id="${p.id}">
              <td>${escapeHtml(p.name)}</td>
              <td>${autoCount}/4</td>
              <td>${p.named.length}</td>
              <td>${last ? new Date(last).toLocaleString() : '—'}</td>
              <td>
                <button data-act="rename">Rename</button>
                <button data-act="delete" class="danger">Delete</button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  list.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    const tr = btn.closest('tr')!;
    const id = tr.dataset.id!;
    if (btn.dataset.act === 'rename') {
      const name = prompt('New name', tr.querySelector('td')!.textContent ?? '');
      if (!name) return;
      await send({ type: 'renameProject', projectId: id, name });
      render();
    } else if (btn.dataset.act === 'delete') {
      if (!confirm('Delete this project and all its snapshots?')) return;
      await send({ type: 'deleteProject', projectId: id });
      render();
    }
  }, { once: true });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

document.getElementById('export')!.addEventListener('click', async () => {
  const r = await send<{ ok: true; data: unknown }>({ type: 'exportAll' });
  const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tabtastic-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('importBtn')!.addEventListener('click', () => {
  (document.getElementById('importFile') as HTMLInputElement).click();
});
document.getElementById('importFile')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const text = await file.text();
  const data = JSON.parse(text);
  const strategy = prompt('On conflict: "overwrite", "skip", or "rename"?', 'overwrite') ?? 'overwrite';
  await send({ type: 'importAll', data, strategy });
  render();
});

render();
```

**Step 3: Build & smoke test**

Run: `npm run build` then reload extension. Right-click icon → Options → see your projects.

**Step 4: Commit**

```bash
git add src/options/
git commit -m "feat: options page with rename/delete, export, import"
```

---

## Task 13: Icons + manifest finalization

Chrome requires icons (16, 32, 48, 128). Use any placeholder you like for now (Tabtastic! mark — could be a simple emoji-on-square PNG).

**Files:**
- Create: `src/assets/icon-16.png`
- Create: `src/assets/icon-32.png`
- Create: `src/assets/icon-48.png`
- Create: `src/assets/icon-128.png`
- Modify: `src/manifest.ts`

**Step 1: Generate placeholder icons**

Use any image tool. For a quick placeholder, run:
```bash
mkdir -p src/assets
# Use any 128x128 PNG. As a one-liner if you have ImageMagick:
# convert -size 128x128 xc:teal -gravity center -pointsize 64 -fill white -annotate +0+0 'T!' src/assets/icon-128.png
# then resize copies for 48/32/16.
```
Or simply drop in any 4 PNG files at the listed paths.

**Step 2: Wire icons in manifest**

```ts
icons: { 16: 'src/assets/icon-16.png', 32: 'src/assets/icon-32.png', 48: 'src/assets/icon-48.png', 128: 'src/assets/icon-128.png' },
action: { default_popup: 'src/popup/index.html', default_title: 'Tabtastic!', default_icon: { 16: 'src/assets/icon-16.png', 32: 'src/assets/icon-32.png' } },
```

**Step 3: Build & verify**

Run: `npm run build` — confirm `dist/` contains the icons.

**Step 4: Commit**

```bash
git add src/assets/ src/manifest.ts
git commit -m "chore: add placeholder icons and wire into manifest"
```

---

## Task 14: README + manual smoke checklist

**Files:**
- Create: `README.md`

**Step 1: Write README**

```markdown
# Tabtastic!
*Window Time Machine for Chrome*

Save and restore your Chrome project windows — tab groups, colors, names, and all.

## Development

```bash
npm install
npm run dev      # vite dev (writes to dist/, HMR for popup/options)
npm run build    # production build → dist/
npm test         # vitest
```

## Loading the extension

1. `npm run build`
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`

## Manual smoke checklist

Run after every meaningful change:

1. Open a window with 3 emoji-prefixed groups → click icon → save as project. ✅ project appears in popup.
2. Make changes (add/remove tab, rearrange) → wait 30s → reopen popup. ✅ "Last auto-save" shows recent.
3. Switch focus to another window → reopen popup on the project. ✅ flushed (auto-save updated immediately on blur).
4. Save a named snapshot called "clean". ✅ appears under Named.
5. Close the project window → click Tabtastic! icon → all projects via options. ✅ project still listed.
6. Restore from auto/hour. ✅ new window opens with groups+colors+order matching.
7. Restore "clean". ✅ same.
8. Export all → reload extension → import. ✅ projects re-appear.
9. Time Machine: in DevTools console for the service worker, override `Date.now` and trigger saves to confirm slot rotation.
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with dev setup and manual smoke checklist"
```

---

## Task 15: Final verification

**Step 1:** Run all checks in parallel:

```bash
npm run typecheck
npm test
npm run build
```

Expected: all green.

**Step 2:** Manual smoke checklist (above) — work through every item, in Chrome.

**Step 3:** Commit any fixes uncovered by smoke testing as `fix:` commits.

**Step 4:** Tag a milestone:

```bash
git tag v0.1.0
```

---

## Out of scope (don't build)

- Pinned tab state, scroll position, form data
- Chrome sync storage / multi-machine sync
- Auto-save history beyond the 4 Time Machine slots
- Cap on named snapshots
- Programmatic setting of OS window titles
- Auto-detect orphan groups by emoji and offer to rebuild from named snapshot (interesting, but YAGNI for v0.1)
