# Tabtastic! — Tickets

Backlog for the Tabtastic! Chrome extension (a.k.a. *Window Time Machine*).

- **Design doc:** [`docs/plans/2026-05-01-chrome-project-snapshots-design.md`](docs/plans/2026-05-01-chrome-project-snapshots-design.md) — the validated design. Always trust this over the archived plan when they disagree.
- **Archived plan (cache):** [`.ai/implementation-plans/archive/2026-05-01-tabtastic-superseded-by-tickets.md`](.ai/implementation-plans/archive/2026-05-01-tabtastic-superseded-by-tickets.md) — original monolithic plan with full code samples for every module. **Do not execute it directly** (the devils-advocate pass found blocking flaws), but **`/writing-plans` MUST read the relevant `Task N` section from this file when planning a ticket** — it captures the original vision, code structure, and test shapes that are still mostly correct. Each ticket below lists which archived task(s) to reference and which parts are now stale.

---

## Working agreements

- **One ticket = one PR/branch.** Tickets are sized so they can be picked up by independent agents in parallel without conflicting.
- **Each ticket gets its own focused implementation plan** before code is written. Use `/oh-my-claudecode:writing-plans` (or `/brainstorming` for trickier tickets) when you pick one up.
- **Shared files are append-only.** `src/lib/types.ts`, `src/lib/messages.ts`, and `src/manifest.ts` are touched by many tickets — each ticket only **adds** its own type/message/permission, never edits another ticket's section. Sections are demarcated with `// === <ticket-id> ===` comment fences.
- **The service worker (`src/background/index.ts`) is a registration shell only.** Each ticket adds its handlers/listeners to its own file under `src/background/handlers/` or `src/background/listeners/` and registers them via a single import in the shell. This keeps the shell from becoming a merge-conflict hotspot.
- **Pre-flight verification:** before depending on a Chrome API, write a 5-line verification snippet (in the ticket's plan) and confirm in DevTools. The devils-advocate pass surfaced several APIs that don't behave as docs imply (`windows.title`, `tabGroups.onMoved`, `prompt()`, `windows.create().tabs`).

## File ownership map

| Path | Owner | Notes |
|---|---|---|
| `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` | T01 | Other tickets only add scripts/dev deps; never edit the build config |
| `src/manifest.ts` | T01 creates; T07 finalizes | Permissions are append-only — each ticket adds its own with a comment fence |
| `src/lib/types.ts` | T02 creates; **append-only** | Each ticket adds its types under a `// === T-NN ===` fence |
| `src/lib/messages.ts` | T01 creates skeleton; **append-only** | Typed message contract; each ticket adds its message types |
| `src/lib/browser.ts` | T01 creates skeleton; **append-only** | Each ticket adds the wrapper methods it needs |
| `src/lib/storage.ts` | T02 |  |
| `src/lib/capture.ts` | T03 |  |
| `src/lib/restore.ts` | T04 |  |
| `src/lib/bindings.ts` | T05 |  |
| `src/lib/debouncer.ts` | T08 |  |
| `src/lib/retention.ts` | T09 |  |
| `src/lib/autosave.ts` | T10 |  |
| `src/popup/**` | T06 |  |
| `src/options/**` | T12 |  |
| `src/background/index.ts` | T01 creates shell; never edited again | Shell only imports from `handlers/` and `listeners/` |
| `src/background/handlers/<feature>.ts` | per-ticket | Each ticket adds its own file |
| `src/background/listeners/<feature>.ts` | per-ticket | Same |
| `src/assets/icon-*.png` | T07 |  |
| `tests/setup/chrome-stub.ts` | T01 |  |

---

# P0 — MVP (manual save/restore; ship after these)

The ambition is: **after P0 the user can manually save and restore project window state from the popup.** Auto-save and management UI come later. Even without auto-save, this already solves the disaster-recovery use case (Chrome lost groups → click restore → window comes back).

---

## T01 — Project scaffolding & shared module skeletons

**Priority:** P0 · **Blockers:** none · **Parallelism:** blocks everything else
**Archive ref:** Task 1 (scaffolding code is correct) + the new `tests/setup/chrome-stub.ts` block in the archive's vitest section (added during devils-advocate review). **Stale:** original Task 1 didn't include the chrome-stub setupFile — use the corrected version.

### Goal
Create a buildable Vite + crxjs + Vitest TypeScript project with empty stubs for all shared modules so downstream tickets can be picked up in parallel without racing on file creation.

### Owned files (create)
- `package.json`, `package-lock.json`
- `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`
- `src/manifest.ts` (skeleton — minimum permissions, action stub, no icons yet)
- `src/lib/browser.ts` (empty `BrowserApi` interface + `createBrowser()` returning `{}` cast)
- `src/lib/types.ts` (just the `// === T-NN ===` fence comments and re-export header)
- `src/lib/messages.ts` (typed message-bus skeleton — `type AnyMessage = never;` placeholder)
- `src/background/index.ts` (registers nothing initially; just imports `./handlers/index.ts` which is also a stub re-exporting nothing)
- `src/background/handlers/index.ts`, `src/background/listeners/index.ts` (empty barrels)
- `tests/setup/chrome-stub.ts` (Proxy-based `globalThis.chrome` so module-level `chrome.*` refs don't `ReferenceError` during Vitest collection)
- `README.md` (dev setup + manual-load instructions)
- `.gitignore` (extend existing)

### Acceptance
- `npm install` succeeds
- `npm run typecheck` exits 0 (no errors)
- `npm test` exits 0 (no tests yet, but `passWithNoTests: true`)
- `npm run build` produces a `dist/` with a valid `manifest.json`
- The built extension loads in `chrome://extensions` (Load unpacked → `dist/`) without errors. Service worker registers and is idle.

### Pitfalls (from devils-advocate)
- `@crxjs/vite-plugin` has historical version-skew issues with Vite majors. Pin to a known-good version. Verify the build output's `manifest.json` actually contains `background.service_worker` pointing at a real file before declaring done.
- Vitest's `node` environment has no `chrome` global. Without the chrome-stub setup file, any module that references `chrome.*` at module-load time will throw `ReferenceError` during test collection — every downstream test ticket would be blocked.

---

## T02 — Data model + storage layer

**Priority:** P0 · **Blockers:** T01 · **Parallelism:** can run in parallel with T03, T04, T05, T07, T08, T09
**Archive ref:** Task 3 (storage layer) — code and tests are accurate. Types come from Task 3 (Step 1) and the type block in the archive's "Data model" section. **Stale:** none.

### Goal
Persist a typed `Project[]` to `chrome.storage.local` with a small CRUD API the rest of the codebase consumes. No business logic — pure CRUD.

### Owned files
- Create: `src/lib/storage.ts`
- Create: `tests/lib/storage.test.ts`
- Modify (append-only): `src/lib/types.ts` — add `Project`, `Snapshot`, `GroupSnap`, `TabSnap`, `AutoSlots` under `// === T02 ===` fence.
- Modify (append-only): `src/lib/browser.ts` — add `storageGet`, `storageSet` to the wrapper.

### API
```ts
interface Storage {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  upsertProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
}
export function createStorage(browser: Pick<BrowserApi, 'storageGet'|'storageSet'>): Storage
```

### Acceptance
- Round-trip a project, list returns it, upsert mutates in place, delete removes it. All tested with an in-memory fake `BrowserApi`.

### Pitfalls
- **Concurrent writes:** if two callers do read-modify-write at once, the later write clobbers the earlier. T17 will add proper serialization; T02 should at least document this and not pretend it's safe.

---

## T03 — Snapshot capture (window → Snapshot)

**Priority:** P0 · **Blockers:** T01, T02 (for types) · **Parallelism:** can run in parallel with T04, T05
**Archive ref:** Task 4 (capture). The capture code and tests transfer directly. **Stale:** the captured `windowName` field must NOT be used to overwrite `project.name` (that bug is fixed at the autosave layer in T10, but T03 should still capture it for display).

### Goal
Pure-ish function `captureSnapshot(browser, windowId, newId, now)` that reads the current state of a Chrome window and returns a `Snapshot` matching the type from T02.

### Owned files
- Create: `src/lib/capture.ts`
- Create: `tests/lib/capture.test.ts`
- Modify (append-only): `src/lib/browser.ts` — add `getWindow`, `queryTabs`, `queryTabGroups` to the wrapper.

### Acceptance
- Captures groups in tab order with their tabs
- Ungrouped tabs (`groupId === -1`) preserved in `ungroupedTabs` in tab-index order
- Group ordering is determined by the index of each group's first tab
- All tested against a fake `BrowserApi`

### Pitfalls
- `chrome.windows.Window.title` is the active tab's `<title>`, **not** a stable user-set window name. **Do not** persist `windowName` as the source of truth for project name. Capture it for display only.
- `chrome.windows.getAll/get` only populates `title` when `populate: true` (and even then, see above). Use `populate: true` here.

---

## T04 — Restore engine (Snapshot → new window)

**Priority:** P0 · **Blockers:** T01, T02 · **Parallelism:** can run in parallel with T03, T05
**Archive ref:** Task 9 (restore). Function shape, error reporting, and the `RestoreFailure`/`RestoreResult` types are accurate. **Stale:** the seed-tab logic that reads `win?.tabs?.[0]?.id` is unreliable in MV3 — replace per the "Pitfalls" section below (open with `about:blank`, create all tabs explicitly, close the seed). The fake-browser test that returns a populated `tabs` array is correspondingly outdated.

### Goal
Pure-ish function `restoreSnapshot(browser, snap)` that opens a fresh window and rebuilds the saved groups + tabs in order. Returns `{ windowId, failures: RestoreFailure[] }` so callers can show a report (T15).

### Owned files
- Create: `src/lib/restore.ts`
- Create: `tests/lib/restore.test.ts`
- Modify (append-only): `src/lib/browser.ts` — add `createWindow`, `createTab`, `groupTabs`, `updateTabGroup`.

### Acceptance
- Creates window with the first URL as seed (or `about:blank` if snapshot is empty)
- Each saved group is recreated with title, color, collapsed state
- Failures (e.g. `chrome://` URLs Chrome refuses to recreate) are recorded in `failures`, not thrown

### Pitfalls
- **Do not** rely on `chrome.windows.create()` returning a populated `tabs` array — in MV3 it is often `undefined` or empty. Either: (a) open the window with `url: 'about:blank'` and create *all* tabs via `createTab`, then close the blank seed; or (b) detect the seed tab by querying tabs in the new window after creation rather than from the `create` return value.
- `chrome.tabs.group` signature: verify against `@types/chrome` before writing — the `createProperties.windowId` field is the documented form, but pin the version.

---

## T05 — Bindings (windowId ↔ projectId)

**Priority:** P0 · **Blockers:** T01, T02 · **Parallelism:** can run in parallel with T03, T04
**Archive ref:** Task 7 (bindings) — the `Map`-based API shape and first-wins collision handling transfer. **Stale:** the `rebuild(windows, projects)` strategy that matches `window.title` to `project.name` is broken (title is the active tab's title, not a stable window name). Replace with `chrome.storage.session`-backed persistence + a `hydrate()` method as specified above. Cross-restart rebinding is now user-driven via the popup, not automatic.

### Goal
An in-memory `Map<windowId, projectId>` backed by `chrome.storage.session` (which survives service-worker eviction within a browser session) so auto-save and the popup can answer "which project is this window?". Browser restart clears bindings; rebinding is user-driven (the popup offers to rebind to an existing project by name).

### Owned files
- Create: `src/lib/bindings.ts`
- Create: `tests/lib/bindings.test.ts`
- Modify (append-only): `src/lib/browser.ts` — add `sessionStorageGet`, `sessionStorageSet`.

### API
```ts
interface Bindings {
  bind(windowId: number, projectId: string): Promise<void>;
  unbindWindow(windowId: number): Promise<void>;
  unbindProject(projectId: string): Promise<void>;
  projectIdFor(windowId: number): string | undefined;
  windowIdFor(projectId: string): number | undefined;
  allBoundWindows(): number[];
  hydrate(): Promise<void>; // load from chrome.storage.session
}
```

### Acceptance
- All bind/unbind operations write through to `chrome.storage.session`
- `hydrate()` rebuilds the in-memory map from session storage on service-worker startup
- First-wins on collision (two windows want same project)
- Tested with an in-memory fake of `sessionStorageGet`/`sessionStorageSet`

### Pitfalls
- The previous design assumed we could rebuild bindings by matching `chrome.windows.Window.title` to project names. **That doesn't work** — title is the active tab's title. Don't go down that path. Cross-restart rebinding is **explicitly out of scope** for v0.1; the popup handles it via "Save as project" with a name-collision check (see T06).
- `chrome.storage.session` has a 10MB quota in Chrome 112+ — generous, but only for in-session bindings (small).

---

## T06 — Popup UI (manual save & restore)

**Priority:** P0 · **Blockers:** T02, T03, T04, T05 · **Parallelism:** none after blockers (UI integrates everything)
**Archive ref:** Task 11 (popup HTML/CSS/TS) and the relevant message handlers in Task 10 (`getCurrentWindowProjectId`, `saveAsProject`, `saveNamedSnapshot`, `restoreSnapshot`, `deleteSnapshot`, `listProjects`). **Stale:** the `prompt('Snapshot name', ...)` call must be replaced with an inline DOM input — `prompt()` is blocked in extension popups. Also: the dynamic `await import('../lib/capture')` inside the message handler should be a static import. The "auto-saves list" portion of the popup ships **empty** in T06 and is filled in by T10/T11.

### Goal
The current-window-focused popup. Lets the user save the current window as a project, save named snapshots, and restore any snapshot. **No auto-save UI** in this ticket — just the manual flow plus an empty "Auto" section placeholder.

### Owned files
- Create: `src/popup/index.html`, `src/popup/index.ts`, `src/popup/styles.css`
- Create: `src/background/handlers/project.ts` (handlers for `saveAsProject`, `listProjects`, `getCurrentWindowProjectId`)
- Create: `src/background/handlers/snapshot.ts` (handlers for `saveNamedSnapshot`, `restoreSnapshot`, `deleteSnapshot`)
- Modify (append-only): `src/lib/messages.ts` — add this ticket's request/response types
- Modify (append-only): `src/background/handlers/index.ts` — register the new handlers

### Acceptance
- Click icon on an unbound window → form to "Save this window as a project" with name pre-filled from window title (NB: only as a hint — the value is whatever Chrome gives us)
- If the typed name matches an existing project, popup offers to **rebind** to that project (preserving its snapshots)
- Click icon on a bound window → shows project name, list of named snapshots with Restore / Delete, and "+ Save Named Snapshot" button
- Saving a named snapshot opens an **inline DOM form** (input + button) — **not** `prompt()`, which is blocked in extension popups
- Restoring opens a new window via T04

### Pitfalls
- **`prompt()` and `alert()` are blocked in extension popups.** All input must be DOM-based.
- The popup closes when it loses focus, which can interrupt async operations. Use `chrome.runtime.sendMessage` and let the service worker do the work; the popup only needs to dispatch and re-render.
- `<button onclick="...">` and inline event handlers are blocked by the default CSP for extensions. Use `addEventListener`.

---

## T07 — Icons + manifest finalization

**Priority:** P0 · **Blockers:** T01 · **Parallelism:** can run in parallel with anything
**Archive ref:** Task 13 (icons + manifest). **Stale:** ordering — in the archive this came after the popup smoke test, which left the smoke test running with no icons. Doing it in P0 (it can land in parallel with T02–T05) means the first end-to-end smoke has icons.

### Goal
Real (or placeholder) icons at 16/32/48/128, wired into the manifest. Finalize all manifest fields needed for store submission later.

### Owned files
- Create: `src/assets/icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`
- Modify: `src/manifest.ts` — add `icons` and `action.default_icon` (within T07's fence)

### Acceptance
- All four icon files exist and are valid PNGs
- Built `dist/manifest.json` references each icon path; the loaded extension shows the icon in the toolbar

---

# P1 — Auto-save tier (the killer feature)

After P0 ships and works manually, layer in auto-save. **All P1 tickets can be planned and built in parallel after their P0 blockers complete.**

---

## T08 — `chrome.alarms`-based debouncer

**Priority:** P1 · **Blockers:** T01 · **Parallelism:** can run in parallel with T09
**Archive ref:** Task 6 (debouncer) — interface shape and the per-key tests transfer in spirit. **Stale (critical):** the entire `setTimeout`-based implementation is dead-on-arrival under MV3 service-worker eviction. Rebuild around `chrome.alarms` per this ticket's spec; the `vi.useFakeTimers()` tests must be replaced with a fake `chrome.alarms` surface.

### Goal
Per-key debouncer backed by `chrome.alarms` so the timer survives MV3 service-worker eviction. **Critical:** `setTimeout` does not survive eviction; using it would silently break auto-save in production.

### Owned files
- Create: `src/lib/debouncer.ts`
- Create: `tests/lib/debouncer.test.ts`
- Modify (append-only): `src/lib/browser.ts` — add `alarmsCreate`, `alarmsClear`, `alarmsOnAlarm` (subscription helper).

### API
```ts
interface AlarmDebouncer {
  schedule(key: string, delayMs: number): Promise<void>; // creates/replaces alarm "tabtastic:<key>"
  flushNow(key: string): Promise<void>; // clears alarm and invokes the registered handler immediately
  cancel(key: string): Promise<void>;
  onFire(handler: (key: string) => void | Promise<void>): void;
}
```

### Acceptance
- Calling `schedule(k, 30000)` twice within 30s results in one fire at the second call's delay (alarm replacement)
- `flushNow` cancels the pending alarm and invokes handler synchronously-ish
- Tested with a fake alarms surface

### Pitfalls
- `chrome.alarms` minimum periodicity is 30 seconds in production, **but one-shot alarms with `when` (absolute timestamp) can be sub-30s** — verify in DevTools before relying on it. Auto-save's 30s debounce is right at this boundary.
- Chrome rate-limits alarm creation under bursts. Coalesce by always replacing the same alarm name; never create a new alarm per event.

---

## T09 — Time Machine retention (4-slot rotation)

**Priority:** P1 · **Blockers:** T01, T02 (for types) · **Parallelism:** can run in parallel with T08
**Archive ref:** Task 5 (retention). The slot/age constants and the test cases are useful as a starting point. **Stale (critical):** the chained-promotion algorithm in the archived `rotate()` produces incorrect results — manual trace shows `day` ends with the displaced hour-snapshot, not `null` as the test asserts. Use the **re-bucketing algorithm** in this ticket's spec instead, and rewrite the test assertions accordingly.

### Goal
Pure function `rotate(slots, fresh, now)` that re-buckets all snapshots (incoming + existing) by their current age into hour/day/week/month slots, keeping the newest in each bucket and dropping anything older than 30 days.

### Algorithm (revised after devils-advocate found the original "chained promotion" model produced incorrect results)
```
For each candidate ∈ [fresh, slots.hour, slots.day, slots.week, slots.month]:
  if candidate is null: skip
  age = now - candidate.takenAt
  if age > 30d: drop
  else if age >= 7d: bucket = month
  else if age >= 1d: bucket = week
  else if age >= 1h: bucket = day
  else: bucket = hour
  if result[bucket] is null OR candidate is newer: result[bucket] = candidate
```

### Owned files
- Create: `src/lib/retention.ts`
- Create: `tests/lib/retention.test.ts`

### Acceptance
- Empty + fresh → fresh in `hour`
- Two saves within an hour → newer one in `hour`, older displaced according to its age
- Snapshots aged past 30d are dropped
- Boundary tests for exactly 1h / 1d / 7d / 30d
- Two snapshots qualifying for the same bucket → newer wins

### Pitfalls
- The original chained-promotion algorithm was broken (manual trace showed test expectations didn't match). **Use the re-bucketing algorithm above.**

---

## T10 — Auto-save engine wiring

**Priority:** P1 · **Blockers:** T03 (capture), T05 (bindings), T08 (debouncer), T09 (retention), T02 (storage) · **Parallelism:** none
**Archive ref:** Task 8 (`autosave.ts` composition) + Task 10 (service worker listener wiring). **Stale:** (1) the `name: snap.windowName || project.name` line in the archive's `autosave.ts` silently renames projects to active-tab titles — drop it. (2) the archive registers `chrome.tabGroups.onMoved`, which doesn't exist and crashes the worker — remove. (3) `chrome.tabs.onUpdated` should filter by `info.status === 'complete'` to avoid debouncer spam. (4) `chrome.windows.getAll` calls need `populate: true` for any place that reads `window.title`.

### Goal
Wire everything together: tab/group events → debouncer → capture → retention → storage. Lives entirely in the service worker; no UI changes.

### Owned files
- Create: `src/lib/autosave.ts` (composition: `tick(windowId, projectId)`)
- Create: `tests/lib/autosave.test.ts`
- Create: `src/background/handlers/autosave.ts` (alarm fire handler that calls `tick`)
- Create: `src/background/listeners/tabs.ts` (registers tab + tabGroups listeners; calls `debouncer.schedule`)
- Modify (append-only): `src/background/handlers/index.ts` and `src/background/listeners/index.ts`
- Modify (append-only): `src/manifest.ts` — add `alarms` permission within T10's fence

### Acceptance
- A change to a tracked window triggers a debounced auto-save 30s later
- The saved snapshot lands in the project's `autoSlots.hour` (after rotation)
- `tick()` is unit-tested with fakes
- **Project name is NOT updated from the captured `windowName`** — it stays whatever the user saved

### Pitfalls
- **Do not register a listener for `chrome.tabGroups.onMoved`** — that event does not exist; registering throws and crashes the service worker on startup.
- `chrome.tabs.onUpdated` fires on every URL/title/favicon change — filter by `info.status === 'complete'` (or use the `properties` filter) to avoid debouncer spam.
- `chrome.tabs.onUpdated` does **not** reliably fire when a tab's `groupId` changes; rely on `chrome.tabGroups.onUpdated` for grouping changes.

---

## T11 — Window blur flush

**Priority:** P1 · **Blockers:** T08, T10 · **Parallelism:** none
**Archive ref:** Task 10 — the `chrome.windows.onFocusChanged` block. **Stale:** the archive uses `bindings.allBoundWindows?.()` with an optional-chain guard; in T05/T11 `allBoundWindows` is a required interface member, so drop the guard.

### Goal
When the user switches focus away from a tracked window, flush its pending debounced save immediately so a fresh snapshot is written before the user might do anything destructive.

### Owned files
- Create: `src/background/listeners/window-focus.ts`
- Modify (append-only): `src/background/listeners/index.ts`

### Acceptance
- `chrome.windows.onFocusChanged` away from a bound window calls `debouncer.flushNow` for that window
- `WINDOW_ID_NONE` (focus left Chrome entirely) flushes all bound windows

---

# P2 — Management UI & polish

These tickets ship after the auto-save tier is stable. Most can be picked up in parallel by independent agents.

---

## T12 — Options page (all-projects manager)

**Priority:** P2 · **Blockers:** T02, T06 (handlers) · **Parallelism:** can run in parallel with T08–T11 (different files)
**Archive ref:** Task 12 (options page HTML/CSS/TS). **Stale:** `list.addEventListener('click', ..., { once: true })` is a bug — remove the `{ once: true }` option. Also replace any `prompt()`/`confirm()` calls with DOM-based UI (`<dialog>` or custom modal).

### Goal
Wider page than the popup, listing every saved project with rename / delete / restore-latest. Foundation for export/import in T13/T14.

### Owned files
- Create: `src/options/index.html`, `src/options/index.ts`, `src/options/styles.css`
- Modify (append-only): `src/background/handlers/project.ts` — add `renameProject`, `deleteProject` if not already in T06
- Modify (append-only): `src/lib/messages.ts`
- Modify: `src/manifest.ts` — set `options_page`

### Acceptance
- Table of all projects with name, snapshot counts, last save, action buttons
- Rename inline (click name → input → save on blur/enter)
- Delete with confirm
- **Click handlers do NOT use `{ once: true }`** — they must remain after the first click

### Pitfalls
- Same CSP rules as the popup — no inline handlers, no `prompt()`/`alert()`/`confirm()` in the document body (use a custom modal or browser-native `<dialog>` element).

---

## T13 — Export all projects → JSON

**Priority:** P2 · **Blockers:** T02, T12 · **Parallelism:** can run in parallel with T14 (different handler files; both append to the options page UI)
**Archive ref:** Task 12 (export button + `exportAll` handler). The Blob-download approach transfers directly. **Stale:** the archive's handler lives in the monolithic service-worker file; in this ticket layout it lives in `src/background/handlers/export.ts`.

### Goal
"Export all" button on the options page that downloads a single JSON file containing every project and snapshot.

### Owned files
- Create: `src/background/handlers/export.ts` (handles `exportAll` message)
- Modify (append-only): `src/options/index.ts` — wire the button
- Modify (append-only): `src/lib/messages.ts`

### Acceptance
- Clicking export downloads a file named `tabtastic-YYYY-MM-DD.json`
- The JSON validates against the type schema (round-trip check in tests)

---

## T14 — Import projects with conflict resolution

**Priority:** P2 · **Blockers:** T02, T12, T13 (uses same JSON shape) · **Parallelism:** none after blockers
**Archive ref:** Task 12 (`importAll` handler + file-input wiring). **Stale:** the archive uses `prompt('On conflict: "overwrite", "skip", or "rename"?', 'overwrite')` — replace with a proper modal. Also the conflict resolver should be a pure function in its own file so it can be unit-tested.

### Goal
"Import" button accepts a JSON file. On project-ID collision, user picks: overwrite / skip / rename.

### Owned files
- Create: `src/background/handlers/import.ts` (handles `importAll` with a `strategy` param)
- Create: `tests/background/handlers/import.test.ts` (unit-test the conflict resolver as a pure function)
- Modify (append-only): `src/options/index.ts` — wire the button + a small modal for strategy choice
- Modify (append-only): `src/lib/messages.ts`

### Acceptance
- Conflict resolver tested for all three strategies
- Imported projects appear in the table immediately

---

## T15 — Restore failure report panel

**Priority:** P2 · **Blockers:** T04, T06 · **Parallelism:** can run in parallel with T16, T17
**Archive ref:** Task 9 (the design doc's "restore report" mention) and the failures-array shape in `src/lib/restore.ts`. **Stale:** the archive doesn't include UI for the failure panel — it's a new addition. Use the design doc's edge-cases table as the spec.

### Goal
After a restore, if the `failures` array is non-empty, show a small panel listing which URLs failed and why (typically `chrome://` URLs or sandbox restrictions).

### Owned files
- Create: `src/popup/restore-report.ts` (or a small DOM module)
- Modify (append-only): `src/popup/index.ts` — call after restore, render report
- Modify (append-only): `src/popup/styles.css`

### Acceptance
- Restoring a snapshot containing `chrome://settings` shows that URL in the failure panel
- Panel is dismissable

---

## T16 — Two-windows-same-name conflict UI

**Priority:** P2 · **Blockers:** T05, T06 · **Parallelism:** can run in parallel with T15, T17
**Archive ref:** the design doc's edge-cases table ("Two windows want the same project name"). **Stale:** the archive has no implementation for this — fully new UI in this ticket.

### Goal
If a user tries to save a window with a project name already bound to a different window, the popup explains and offers alternatives (rename, or use a different name).

### Owned files
- Modify (append-only): `src/popup/index.ts`
- Modify (append-only): `src/popup/styles.css`

### Acceptance
- Attempting to bind a second window to a name in use shows the conflict UI
- "Rename" path lets the user save with a different name

---

## T17 — Storage write serialization

**Priority:** P2 · **Blockers:** T02 · **Parallelism:** can run in parallel with T15, T16
**Archive ref:** Task 3 (storage layer) — same module, but adding a per-project promise-chain wrapper around `upsertProject`. **Stale:** the archive's `storage.ts` does plain read-modify-write with no concurrency guard.

### Goal
Serialize concurrent `upsertProject` calls so the read-modify-write cycle is atomic per project. Without this, two simultaneous auto-save ticks (e.g. from blur-flush across two windows) can clobber each other.

### Owned files
- Modify: `src/lib/storage.ts` (extend with a per-key promise chain)
- Modify: `tests/lib/storage.test.ts` (add concurrent-write test)

### Acceptance
- A test that fires two `upsertProject` calls concurrently against the same project preserves both writes' fields
- All existing storage tests still pass

---

## Dependency / parallelism summary

```
T01 (scaffolding) ─┬─→ T02 (storage) ─┬─→ T06 (popup) ─→ P0 ship
                   │                  │
                   ├─→ T03 (capture) ─┤
                   ├─→ T04 (restore) ─┤
                   ├─→ T05 (bindings)─┘
                   ├─→ T07 (icons)
                   ├─→ T08 (debouncer) ─┐
                   └─→ T09 (retention) ─┴─→ T10 (autosave wiring) ─→ T11 (blur)
                                                                          │
                                       T12 (options) ─┬─→ T13 (export) ──┴─→ T14 (import)
                                                      └─→ T15, T16, T17 (parallel)
```

After T01, the following can run **simultaneously** with no merge conflicts (each owns a distinct lib module, with append-only edits to the shared files):
- **Wave A (post-T01):** T02, T03, T04, T05, T07, T08, T09 — seven tickets in parallel
- **Wave B (after Wave A):** T06, T10, T12 — three in parallel
- **Wave C (after Wave B):** T11, T13, T15, T16, T17 — five in parallel
- **Wave D (after T13):** T14
