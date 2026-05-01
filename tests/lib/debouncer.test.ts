import { describe, it, expect, vi } from 'vitest';
import { createAlarmDebouncer } from '../../src/lib/debouncer';

function fakeAlarms() {
  const alarms = new Map<string, chrome.alarms.Alarm>();
  let listener: ((alarm: chrome.alarms.Alarm) => void) | null = null;
  return {
    alarms,
    fire(name: string) {
      const a = alarms.get(name);
      if (!a) return;
      alarms.delete(name);
      listener?.(a);
    },
    deps: {
      alarmsCreate: async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
        alarms.set(name, {
          name,
          scheduledTime: info.when ?? Date.now(),
        } as chrome.alarms.Alarm);
      },
      alarmsClear: async (name: string) => {
        const had = alarms.delete(name);
        return had;
      },
      alarmsOnAlarm: (fn: (alarm: chrome.alarms.Alarm) => void) => {
        listener = fn;
      },
    },
  };
}

describe('createAlarmDebouncer', () => {
  it('schedules an alarm and fires the handler when it triggers', async () => {
    const { fire, deps, alarms } = fakeAlarms();
    const d = createAlarmDebouncer(deps);
    const handler = vi.fn();
    d.onFire(handler);

    await d.schedule('w1', 1000);
    expect(alarms.has('tabtastic:w1')).toBe(true);

    fire('tabtastic:w1');
    await Promise.resolve();
    expect(handler).toHaveBeenCalledWith('w1');
  });

  it('replaces a pending alarm when scheduled again (coalescing)', async () => {
    const { deps, alarms } = fakeAlarms();
    const d = createAlarmDebouncer(deps);
    d.onFire(vi.fn());

    await d.schedule('w1', 1000);
    const first = alarms.get('tabtastic:w1');
    await d.schedule('w1', 5000);
    const second = alarms.get('tabtastic:w1');

    expect(alarms.size).toBe(1);
    expect(second).not.toBe(first);
    expect(second!.scheduledTime).toBeGreaterThan(first!.scheduledTime);
  });

  it('flushNow clears the alarm and invokes the handler immediately', async () => {
    const { deps, alarms } = fakeAlarms();
    const d = createAlarmDebouncer(deps);
    const handler = vi.fn();
    d.onFire(handler);

    await d.schedule('w1', 10_000);
    await d.flushNow('w1');

    expect(handler).toHaveBeenCalledWith('w1');
    expect(alarms.has('tabtastic:w1')).toBe(false);
  });

  it('flushNow on a key with no pending alarm is a no-op', async () => {
    const { deps } = fakeAlarms();
    const d = createAlarmDebouncer(deps);
    const handler = vi.fn();
    d.onFire(handler);
    await d.flushNow('w1');
    expect(handler).not.toHaveBeenCalled();
  });

  it('cancel removes the alarm without firing', async () => {
    const { deps, alarms } = fakeAlarms();
    const d = createAlarmDebouncer(deps);
    const handler = vi.fn();
    d.onFire(handler);

    await d.schedule('w1', 1000);
    await d.cancel('w1');

    expect(alarms.has('tabtastic:w1')).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps schedules per-key separate', async () => {
    const { fire, deps } = fakeAlarms();
    const d = createAlarmDebouncer(deps);
    const handler = vi.fn();
    d.onFire(handler);

    await d.schedule('w1', 1000);
    await d.schedule('w2', 1000);
    fire('tabtastic:w1');
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('w1');
  });
});
