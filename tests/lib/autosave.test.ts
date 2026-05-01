import { describe, it, expect } from 'vitest';
import { createAutoSave } from '../../src/lib/autosave';
import type { Project } from '../../src/lib/types';

function setup(initial: Project[]) {
  const store = new Map<string, unknown>([['projects', initial]]);
  const browser = {
    storageGet: async <T>(key: string) => store.get(key) as T | undefined,
    storageSet: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    getWindow: async () => ({ id: 10, title: 'Acme – live tab title' }) as unknown as chrome.windows.Window,
    queryTabs: async () =>
      [
        { id: 1, windowId: 10, index: 0, groupId: -1, url: 'https://x.com', title: 'X' },
      ] as unknown as chrome.tabs.Tab[],
    queryTabGroups: async () => [] as chrome.tabGroups.TabGroup[],
  };
  return { store, browser };
}

const proj = (id: string, name: string): Project => ({
  id,
  name,
  createdAt: 0,
  autoSlots: { hour: null, day: null, week: null, month: null },
  named: [],
});

describe('autosave.tick', () => {
  it('writes a snapshot into the project hour slot', async () => {
    const { store, browser } = setup([proj('p1', 'Acme')]);
    const auto = createAutoSave(
      browser,
      () => 'sid',
      () => 5000,
    );
    await auto.tick(10, 'p1');
    const projects = store.get('projects') as Project[];
    expect(projects[0]!.autoSlots.hour?.id).toBe('sid');
    expect(projects[0]!.autoSlots.hour?.takenAt).toBe(5000);
  });

  it('does NOT overwrite project.name with the captured windowName', async () => {
    const { store, browser } = setup([proj('p1', 'Original Name')]);
    const auto = createAutoSave(
      browser,
      () => 'sid',
      () => 0,
    );
    await auto.tick(10, 'p1');
    const projects = store.get('projects') as Project[];
    expect(projects[0]!.name).toBe('Original Name');
  });

  it('is a no-op when project is not found', async () => {
    const { store, browser } = setup([]);
    const auto = createAutoSave(
      browser,
      () => 'sid',
      () => 0,
    );
    await auto.tick(10, 'p1');
    expect(store.get('projects')).toEqual([]);
  });
});
