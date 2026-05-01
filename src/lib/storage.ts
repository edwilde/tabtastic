import type { BrowserApi } from './browser';
import type { Project } from './types';

const KEY = 'projects';

export interface Storage {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  upsertProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  /** Replace the entire project list (used by import). */
  replaceAll(projects: Project[]): Promise<void>;
}

type StorageDeps = Pick<BrowserApi, 'storageGet' | 'storageSet'>;

export function createStorage(browser: StorageDeps): Storage {
  // Per-process serialization queue: ensures concurrent upserts don't clobber.
  // T17 will extend this if the simple chain isn't sufficient.
  let chain: Promise<void> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  async function readAll(): Promise<Project[]> {
    return (await browser.storageGet<Project[]>(KEY)) ?? [];
  }
  async function writeAll(list: Project[]): Promise<void> {
    await browser.storageSet(KEY, list);
  }

  return {
    listProjects: readAll,
    async getProject(id) {
      return (await readAll()).find((p) => p.id === id);
    },
    upsertProject(p) {
      return serialize(async () => {
        const all = await readAll();
        const idx = all.findIndex((x) => x.id === p.id);
        if (idx >= 0) all[idx] = p;
        else all.push(p);
        await writeAll(all);
      });
    },
    deleteProject(id) {
      return serialize(async () => {
        await writeAll((await readAll()).filter((p) => p.id !== id));
      });
    },
    replaceAll(projects) {
      return serialize(() => writeAll(projects));
    },
  };
}
