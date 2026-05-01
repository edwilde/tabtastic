import type { BrowserApi } from './browser';

const PREFIX = 'tabtastic:';

type AlarmDeps = Pick<BrowserApi, 'alarmsCreate' | 'alarmsClear' | 'alarmsOnAlarm'>;

export interface AlarmDebouncer {
  /** Schedule (or replace) an alarm `delayMs` from now for this key. */
  schedule(key: string, delayMs: number): Promise<void>;
  /** Clear the alarm and invoke the registered handler synchronously. */
  flushNow(key: string): Promise<void>;
  /** Clear the alarm without firing. */
  cancel(key: string): Promise<void>;
  /** Register the handler that's invoked when an alarm fires. */
  onFire(handler: (key: string) => void | Promise<void>): void;
}

/**
 * Per-key debouncer backed by chrome.alarms so the timer survives MV3
 * service-worker eviction. Calling `schedule(k, delay)` again before the
 * alarm fires *replaces* the alarm — coalescing rapid calls to one fire.
 *
 * Note: `chrome.alarms.create` accepts sub-30s `when` timestamps for one-shot
 * alarms (the 30s minimum is for *periodic* alarms). The 30s auto-save
 * debounce is right at this boundary — if Chrome enforces a higher floor
 * in your version, increase the delay caller-side rather than in here.
 */
export function createAlarmDebouncer(browser: AlarmDeps): AlarmDebouncer {
  let handler: (key: string) => void | Promise<void> = () => undefined;
  let listenerWired = false;

  function wireListenerIfNeeded(): void {
    if (listenerWired) return;
    listenerWired = true;
    browser.alarmsOnAlarm((alarm) => {
      if (!alarm.name.startsWith(PREFIX)) return;
      const key = alarm.name.slice(PREFIX.length);
      void handler(key);
    });
  }

  return {
    async schedule(key, delayMs) {
      wireListenerIfNeeded();
      const name = PREFIX + key;
      await browser.alarmsCreate(name, { when: Date.now() + Math.max(0, delayMs) });
    },
    async flushNow(key) {
      wireListenerIfNeeded();
      const name = PREFIX + key;
      const cleared = await browser.alarmsClear(name);
      if (cleared) {
        await handler(key);
      }
    },
    async cancel(key) {
      const name = PREFIX + key;
      await browser.alarmsClear(name);
    },
    onFire(h) {
      handler = h;
      wireListenerIfNeeded();
    },
  };
}
