import { describe, it, expect } from 'vitest';
import { createStorage } from '../../src/lib/storage';
import type { Project } from '../../src/lib/types';

function fakeBrowser() {
  const store = new Map<string, unknown>();
  return {
    storageGet: async <T>(key: string) => store.get(key) as T | undefined,
    storageSet: async (key: string, value: unknown) => {
      store.set(key, value);
    },
  };
}

const proj = (id: string, name: string): Project => ({
  id,
  name,
  createdAt: 1,
  autoSlots: { hour: null, day: null, week: null, month: null },
  named: [],
});

describe('storage', () => {
  it('returns empty array when nothing stored', async () => {
    const s = createStorage(fakeBrowser());
    expect(await s.listProjects()).toEqual([]);
  });

  it('round-trips a project', async () => {
    const s = createStorage(fakeBrowser());
    const p = proj('p1', 'Acme');
    await s.upsertProject(p);
    expect(await s.listProjects()).toEqual([p]);
    expect(await s.getProject('p1')).toEqual(p);
  });

  it('updates an existing project on upsert', async () => {
    const s = createStorage(fakeBrowser());
    const p = proj('p1', 'Acme');
    await s.upsertProject(p);
    await s.upsertProject({ ...p, name: 'Acme Renamed' });
    const all = await s.listProjects();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('Acme Renamed');
  });

  it('deletes a project', async () => {
    const s = createStorage(fakeBrowser());
    await s.upsertProject(proj('p1', 'Acme'));
    await s.deleteProject('p1');
    expect(await s.listProjects()).toEqual([]);
  });

  it('serializes concurrent upserts so neither write is lost', async () => {
    const s = createStorage(fakeBrowser());
    await Promise.all([
      s.upsertProject(proj('p1', 'A')),
      s.upsertProject(proj('p2', 'B')),
    ]);
    const all = await s.listProjects();
    expect(all.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });

  it('replaceAll swaps the entire list', async () => {
    const s = createStorage(fakeBrowser());
    await s.upsertProject(proj('p1', 'A'));
    await s.replaceAll([proj('p2', 'B'), proj('p3', 'C')]);
    expect((await s.listProjects()).map((p) => p.id)).toEqual(['p2', 'p3']);
  });
});
