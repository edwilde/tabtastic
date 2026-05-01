import { describe, it, expect } from 'vitest';
import { rotate, HOUR, DAY, WEEK, MONTH } from '../../src/lib/retention';
import type { AutoSlots, Snapshot } from '../../src/lib/types';

const empty = (): AutoSlots => ({ hour: null, day: null, week: null, month: null });
const snap = (id: string, takenAt: number): Snapshot => ({
  id,
  takenAt,
  windowName: 'w',
  groups: [],
  ungroupedTabs: [],
});

describe('rotate (Time Machine retention)', () => {
  it('puts a fresh snapshot in hour with empty slots', () => {
    const out = rotate(empty(), snap('a', 1000), 1000);
    expect(out).toEqual({ hour: snap('a', 1000), day: null, week: null, month: null });
  });

  it('replaces hour with newer snapshot when prior hour is still <1h old', () => {
    const slots = { ...empty(), hour: snap('a', 0) };
    const now = 30 * 60 * 1000;
    const out = rotate(slots, snap('b', now), now);
    expect(out.hour).toEqual(snap('b', now));
    expect(out.day).toBeNull();
  });

  it('promotes the prior hour-snapshot to day when it has aged past 1h', () => {
    const slots = { ...empty(), hour: snap('a', 0) };
    const now = HOUR;
    const out = rotate(slots, snap('b', now), now);
    expect(out.hour).toEqual(snap('b', now));
    expect(out.day).toEqual(snap('a', 0));
  });

  it('re-buckets all snapshots by current age', () => {
    // h aged 25d → month, d aged 26d → month (h newer wins), w aged 32d → drop
    const slots: AutoSlots = {
      hour: snap('h', 0),
      day: snap('d', -DAY),
      week: snap('w', -WEEK),
      month: null,
    };
    const now = 25 * DAY;
    const out = rotate(slots, snap('new', now), now);
    expect(out.hour).toEqual(snap('new', now));
    // h is 25d old → month; d is 26d → month bucket too, but h is newer; w is 32d → drop.
    expect(out.month).toEqual(snap('h', 0));
    expect(out.week).toBeNull();
    expect(out.day).toBeNull();
  });

  it('drops snapshots older than 30 days', () => {
    const slots: AutoSlots = {
      hour: null,
      day: null,
      week: null,
      month: snap('old', 0),
    };
    const now = 31 * DAY;
    const out = rotate(slots, snap('new', now), now);
    expect(out.month).toBeNull();
    expect(out.hour).toEqual(snap('new', now));
  });

  it('keeps month while ≤30 days', () => {
    const slots: AutoSlots = {
      hour: null,
      day: null,
      week: null,
      month: snap('m', 0),
    };
    const now = 20 * DAY;
    const out = rotate(slots, snap('new', now), now);
    expect(out.month).toEqual(snap('m', 0));
  });

  it('boundary: snapshot exactly 1h old goes to day', () => {
    const slots = { ...empty(), hour: snap('a', 0) };
    const now = HOUR;
    const out = rotate(slots, snap('b', now), now);
    expect(out.day).toEqual(snap('a', 0));
  });

  it('boundary: snapshot exactly 1d old goes to week', () => {
    const slots = { ...empty(), day: snap('a', 0) };
    const now = DAY;
    const out = rotate(slots, snap('b', now), now);
    expect(out.week).toEqual(snap('a', 0));
  });

  it('boundary: snapshot exactly 7d old goes to month', () => {
    const slots = { ...empty(), week: snap('a', 0) };
    const now = WEEK;
    const out = rotate(slots, snap('b', now), now);
    expect(out.month).toEqual(snap('a', 0));
  });

  it('boundary: snapshot exactly 30d old is kept in month', () => {
    const slots = { ...empty(), month: snap('a', 0) };
    const now = MONTH;
    const out = rotate(slots, snap('b', now), now);
    expect(out.month).toEqual(snap('a', 0));
  });

  it('two candidates qualifying for the same bucket → newer wins', () => {
    const slots: AutoSlots = {
      hour: snap('newer', 100),
      day: null,
      week: null,
      month: null,
    };
    const now = 200; // both fit in hour bucket (age <1h)
    const out = rotate(slots, snap('newest', now), now);
    expect(out.hour).toEqual(snap('newest', now));
  });
});
