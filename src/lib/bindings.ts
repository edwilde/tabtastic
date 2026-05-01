import type { BrowserApi } from './browser';

const KEY = 'bindings';

type Persisted = Record<string, string>; // windowId(string) → projectId

type SessionDeps = Pick<BrowserApi, 'sessionStorageGet' | 'sessionStorageSet'>;

export interface Bindings {
  /** Load the persisted map from chrome.storage.session into memory. */
  hydrate(): Promise<void>;
  bind(windowId: number, projectId: string): Promise<void>;
  unbindWindow(windowId: number): Promise<void>;
  unbindProject(projectId: string): Promise<void>;
  projectIdFor(windowId: number): string | undefined;
  windowIdFor(projectId: string): number | undefined;
  allBoundWindows(): number[];
}

/**
 * Maintains the windowId ↔ projectId map. Persisted in chrome.storage.session
 * so it survives MV3 service-worker eviction within a session. Cleared on
 * browser restart — cross-restart rebinding is user-driven via the popup.
 */
export function createBindings(browser: SessionDeps): Bindings {
  const w2p = new Map<number, string>();
  const p2w = new Map<string, number>();

  async function persist(): Promise<void> {
    const out: Persisted = {};
    for (const [wid, pid] of w2p) out[String(wid)] = pid;
    await browser.sessionStorageSet(KEY, out);
  }

  return {
    async hydrate() {
      w2p.clear();
      p2w.clear();
      const raw = (await browser.sessionStorageGet<Persisted>(KEY)) ?? {};
      for (const [widStr, pid] of Object.entries(raw)) {
        const wid = Number(widStr);
        if (!Number.isFinite(wid)) continue;
        if (p2w.has(pid)) continue; // first-wins on collision
        w2p.set(wid, pid);
        p2w.set(pid, wid);
      }
    },

    async bind(windowId, projectId) {
      if (p2w.has(projectId)) return; // first-wins
      w2p.set(windowId, projectId);
      p2w.set(projectId, windowId);
      await persist();
    },

    async unbindWindow(windowId) {
      const pid = w2p.get(windowId);
      if (!pid) return;
      w2p.delete(windowId);
      p2w.delete(pid);
      await persist();
    },

    async unbindProject(projectId) {
      const wid = p2w.get(projectId);
      if (wid === undefined) return;
      p2w.delete(projectId);
      w2p.delete(wid);
      await persist();
    },

    projectIdFor: (id) => w2p.get(id),
    windowIdFor: (id) => p2w.get(id),
    allBoundWindows: () => [...w2p.keys()],
  };
}
