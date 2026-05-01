# Tabtastic! — Design

**Name:** Tabtastic!
**Tagline (manifest `description`):** Save and restore your Chrome project windows — tab groups, colors, names, and all.
**Date:** 2026-05-01
**Status:** Design validated, ready for implementation planning

## Problem

The user runs one Chrome window per project. Each project has several tab groups that share an emoji prefix and color so the project is visually identifiable when flipping between windows. The window is named after the project. When Chrome occasionally loses all the groups, the emoji prefix is the only thing that helps reassociate the resulting orphan tabs with their project.

Goal: a Chrome extension that saves the full state of each project (window name, tab groups with emoji prefix and color, tabs within each group) and can restore it after Chrome loses state, or roll back to a known-clean baseline when a project window has accumulated cruft.

## Decisions (from brainstorm)

| # | Topic | Decision |
|---|---|---|
| 1 | Save model | Continuous auto-save **plus** manual named snapshots (clean baselines for rollback) |
| 2 | Project identity | Window title is the default project name; popup allows override |
| 3 | Restore behavior | Always opens a new window. Saved data: groups + URLs in order (no pinned/active state) |
| 4 | Storage | `chrome.storage.local` + JSON export/import (no Chrome sync) |
| 5 | Retention | 4-slot Time Machine (hour / day / week / month) for auto-saves; unlimited named snapshots |
| 6 | Popup UI | Current-window-focused. All-projects view lives on the options page |
| 7 | Auto-save trigger | Change-debounced 30s, plus immediate flush on window blur |

## Stack

Manifest V3 Chrome extension. Three contexts:

- **Service worker** (`background.js`) — owns auto-save listeners, retention rotation, storage writes, restore orchestration, binding map.
- **Popup** (`popup.html` + `popup.js`) — current-window view (save snapshot, restore from auto/named).
- **Options page** (`options.html` + `options.js`) — all-projects manager, export/import, rename/delete.

**Permissions:** `tabs`, `tabGroups`, `windows`, `storage`, `alarms`.

## Data model

Persisted in `chrome.storage.local` under a single root key `projects`:

```ts
type Project = {
  id: string;              // stable UUID
  name: string;            // display name; defaults to window title at first save
  createdAt: number;
  autoSlots: {             // 4-slot Time Machine
    hour:  Snapshot | null;
    day:   Snapshot | null;
    week:  Snapshot | null;
    month: Snapshot | null;
  };
  named: Snapshot[];       // unlimited, user-created, ordered by takenAt desc
};

type Snapshot = {
  id: string;
  label?: string;          // present only for named snapshots
  takenAt: number;         // ms epoch
  windowName: string;
  groups: Array<{
    title: string;         // includes emoji prefix
    color: chrome.tabGroups.ColorEnum;
    collapsed: boolean;
    tabs: Array<{ url: string; title: string }>;
  }>;
  ungroupedTabs: Array<{ url: string; title: string }>;
};
```

**Bindings** — a `Map<windowId, projectId>` is held in service-worker memory only. It is rebuilt on service-worker wake by matching each open window's title against project names. (Storing it persistently is unnecessary because `windowId` is not stable across Chrome restarts.)

## Auto-save engine

### Listeners
- `tabs.onCreated`, `tabs.onRemoved`, `tabs.onUpdated`, `tabs.onMoved`, `tabs.onAttached`, `tabs.onDetached`
- `tabGroups.onCreated`, `tabGroups.onUpdated`, `tabGroups.onRemoved`, `tabGroups.onMoved`
- `windows.onFocusChanged`

### Behavior
1. Any tab/group change in a tracked window starts (or resets) a per-window 30-second debounce timer.
2. `windows.onFocusChanged` away from a tracked window flushes that window's pending debounce immediately.
3. On flush: capture the current window state into a `Snapshot`, then run retention rotation (below).
4. If the window's title has changed since the last save and it doesn't conflict with another project, the project's `name` is updated.

### Retention rotation (Time Machine semantics)
Runs on every auto-save. O(4) work, no scheduled sweep needed.

```
new = freshly captured snapshot

oldHour  = autoSlots.hour
autoSlots.hour = new

if oldHour and ageOf(oldHour) >= 1h:
    oldDay   = autoSlots.day
    autoSlots.day = oldHour
    if oldDay and ageOf(oldDay) >= 1d:
        oldWeek  = autoSlots.week
        autoSlots.week = oldDay
        if oldWeek and ageOf(oldWeek) >= 7d:
            oldMonth = autoSlots.month
            autoSlots.month = oldWeek
            // anything previously in `month` ages out (≥30d) and is dropped
```

End state: at most 4 auto snapshots per project, covering roughly the last month, with each slot holding the most recent snapshot whose age falls in that bucket.

## Restore flow

User picks a snapshot (auto or named) from the popup or options page. Service worker:

1. `chrome.windows.create({ url: firstUrl, focused: true })` — opens a new window seeded with the first tab.
2. For each group, in saved order:
   - For each remaining tab: `chrome.tabs.create({ windowId, url, active: false })`, collect tab IDs.
   - `chrome.tabs.group({ tabIds, createProperties: { windowId } })`.
   - `chrome.tabGroups.update(groupId, { title, color, collapsed })`.
3. Append `ungroupedTabs` to the window after all groups.
4. Re-bind `windowId → projectId` so auto-save resumes immediately.
5. Surface a per-snapshot **restore report** if any tab failed to recreate (e.g. `chrome://` URLs Chrome refuses to recreate, file URLs without permission). Report opens in a small post-restore panel.

### Window-name limitation
Chrome doesn't expose a programmatic API to set persistent window names; the user already sets these via Chrome's built-in window naming, and that name persistence is handled by Chrome itself. The extension stores `windowName` for display in the popup ("matching window already open?") and as a hint to the user, but cannot force-set the OS-level window title. **Documented as a known limitation.**

## UI surfaces

### Popup (current-window focused)
```
┌─ Project: 🚀 Acme Redesign ──────────[⚙]┐
│ Window: "Acme Redesign"   [edit name]    │
│ Last auto-save: 2 min ago                │
│                                          │
│  [ + Save Named Snapshot… ]              │
│                                          │
│ Auto                                     │
│  • 2 min ago        [restore]            │
│  • 4 hours ago      [restore]            │
│  • 3 days ago       [restore]            │
│  • (no month slot)                       │
│                                          │
│ Named                                    │
│  • clean baseline       [restore] [×]    │
│  • pre-refactor         [restore] [×]    │
└──────────────────────────────────────────┘
```

If the current window has no project bound, the popup shows:
```
[ Save this window as a project… ]
```
with the name pre-filled from the window title.

The gear icon opens the options page.

### Options page
- Table of all projects: name, # auto snapshots, # named snapshots, last save, actions (Restore latest, Rename, Delete, Export this project).
- Top bar: **Export all** (downloads a single JSON), **Import** (file picker; on conflict, prompts overwrite/skip/rename per project).
- Project detail drawer (click row): full snapshot list with timestamps and tab counts.

## Edge cases

| Case | Handling |
|---|---|
| Two windows want the same project name | First-wins on binding. Second window's popup shows: "This name is taken — use a different one?" |
| Group with no emoji prefix | Saved verbatim. Emoji is convention, not a requirement. |
| Pinned tabs / active tab | Out of scope per Q3. |
| `chrome://` and `file://` URLs | Saved as-is. Restored best-effort. Failures appear in the restore report. |
| Service worker eviction | Bindings rebuilt on wake by matching open window titles to project names. |
| Project window closed | Bindings drop on `windows.onRemoved`. Auto-saves stop. Last auto-save remains in storage. |
| Snapshot list grows huge | Named are unlimited but local-only and small (~few KB each). Export gives a hard backup. No cap. |

## Testing

### Unit (vitest)
- **Retention rotation**: table-driven tests over a fake clock, covering all bucket-boundary cases (snapshot ages exactly 1h, 1d, 7d, 30d; multiple saves within same bucket; chains of promotions).
- **Snapshot serialization**: round-trip a `Snapshot` through JSON; assert deep equality.
- **Import conflict resolution**: same project ID present locally and in import file → overwrite/skip/rename branches.

### Integration
- All Chrome API calls funnel through a single `browser.ts` wrapper module so tests can fake them. Avoids fragile direct mocking of `chrome.*`.
- Tests for: bind on save, rebind on wake, restore reconstructs groups in order with correct color/title/collapsed state.

### Manual smoke checklist (in design doc, run before each release)
1. Create a project window with 3 emoji-prefixed groups → save → confirm appears in popup.
2. Make changes, wait 30s → confirm auto-save updated.
3. Switch focus to another window → confirm immediate flush.
4. Save named snapshot → confirm appears under Named.
5. Close the project window → restore from auto → groups + colors + order match.
6. Restore from named "clean baseline" → confirm.
7. Export all → re-import into clean profile → projects present.
8. Time Machine: manipulate `Date.now` in dev to age snapshots past 1h, 1d, 7d, 30d boundaries → confirm slot rotation matches the table above.

## Out of scope (not building)

- Pinned tab state, scroll position, form data
- Chrome sync storage
- Multi-machine sync
- Auto-save history beyond the 4 Time Machine slots
- Cap on named snapshots
- Programmatic setting of OS window titles
