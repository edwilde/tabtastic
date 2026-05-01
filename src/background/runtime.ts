// Singleton wiring for the service-worker runtime. Imported by every handler
// and listener module so they share one BrowserApi, Bindings, AutoSave, and
// AlarmDebouncer instance.

import { createBrowser } from '../lib/browser';
import { createBindings } from '../lib/bindings';
import { createStorage } from '../lib/storage';
import { createAutoSave } from '../lib/autosave';
import { createAlarmDebouncer } from '../lib/debouncer';

export const browser = createBrowser();
export const storage = createStorage(browser);
export const bindings = createBindings(browser);
export const autoSave = createAutoSave(
  browser,
  () => crypto.randomUUID(),
  () => Date.now(),
);
export const debouncer = createAlarmDebouncer(browser);

/** Auto-save debounce delay in ms. */
export const AUTOSAVE_DELAY_MS = 30_000;

let hydrated: Promise<void> | null = null;
export function ensureHydrated(): Promise<void> {
  if (!hydrated) hydrated = bindings.hydrate();
  return hydrated;
}
