import type { AutoSlots, Snapshot } from './types';

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
export const MONTH = 30 * DAY;

type SlotKey = keyof AutoSlots;

function bucketFor(ageMs: number): SlotKey | null {
  if (ageMs > MONTH) return null;
  if (ageMs >= WEEK) return 'month';
  if (ageMs >= DAY) return 'week';
  if (ageMs >= HOUR) return 'day';
  return 'hour';
}

/**
 * Re-buckets all candidate snapshots by their current age into hour/day/week/
 * month slots. The newer snapshot wins when two candidates share a bucket.
 * Snapshots older than MONTH are dropped.
 */
export function rotate(slots: AutoSlots, fresh: Snapshot, now: number): AutoSlots {
  const candidates: Snapshot[] = [
    fresh,
    slots.hour,
    slots.day,
    slots.week,
    slots.month,
  ].filter((s): s is Snapshot => s !== null);

  const result: AutoSlots = { hour: null, day: null, week: null, month: null };

  for (const s of candidates) {
    const bucket = bucketFor(now - s.takenAt);
    if (!bucket) continue;
    const incumbent = result[bucket];
    if (!incumbent || incumbent.takenAt < s.takenAt) {
      result[bucket] = s;
    }
  }

  return result;
}
