# Tabtastic — project notes

Chrome MV3 extension. Save & restore project windows (tab groups, colours, names).

## Build / install / release — read this before "it still shows the old version"

`npm run build` writes **only `dist/`**. Chrome does **not** load `dist/`.

- **Chrome loads `releases/tabtastic/`** — the version-less, stable unpacked folder.
  It's kept version-less on purpose so the extension ID never changes. It is
  **gitignored**, so it won't show in `git status`.
- After every build, sync it or Chrome shows stale code:
  ```
  rsync -a --delete dist/ releases/tabtastic/
  ```
  Then hit reload on the card in `chrome://extensions`.

### Cutting a release (e.g. 0.7.0)

1. Bump the version in **all** of: `package.json`, `package-lock.json`
   (two lines near the top — both the root and the `""` package entry),
   and `src/manifest.ts` (`version: '…'`).
2. `npm run build`.
3. Replace the committed zip — `releases/tabtastic-<old>.zip` is removed and a
   new one created from `dist/` with the same recipe CI uses:
   ```
   ( cd dist && zip -rq "../releases/tabtastic-<new>.zip" . -x "*.DS_Store" )
   ```
   The `releases/*.zip` files **are committed** (the prebuilt zip ships with the
   source); `releases/tabtastic/` is not.
4. Sync the install folder (see above) so the locally loaded extension matches.
5. Commit. Message style: `feat: <summary>; release <new>` with a
   `Co-Authored-By:` trailer.
6. CI rebuilds + packages on every push; pushing a `v*` **tag** cuts a GitHub
   Release. (Tags are not created automatically — push one if you want the release.)

## Architecture

- **Pure logic in `src/lib/`** (unit-tested directly), **thin wiring in
  `src/background/`** (handlers + listeners share singletons from
  `src/background/runtime.ts`). New background logic should follow this split so
  it stays testable — see `src/lib/reconcile.ts` (pure) vs
  `src/background/reconcile.ts` (wiring).
- **Bindings (windowId → projectId) live in `chrome.storage.session`**, which is
  **wiped on browser restart** (and restored windows get new IDs). So a window
  is "unlinked" after every restart until something re-binds it.
- **Auto-binding** re-links a window to its project from the Chrome **window
  name** (Window → Name Window…), which surfaces in `window.title` and survives
  restart. `bestTitleMatch` (`src/lib/match.ts`) returns a strong `name-window`
  match (title carries the project name as a prefix) or a looser
  `title-contains`. Only `name-window` auto-binds; `title-contains` is a
  popup-only suggestion — never silently mis-bind. There is **no Chrome API to
  set a window's name**, so unnamed windows can't be auto-named.

## Commands

- `npm test` — vitest (run once)
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — vite build → `dist/`
