import type { BrowserApi } from './browser';
import { captureSnapshot } from './capture';
import { rotate } from './retention';
import { createStorage } from './storage';

type AutoSaveDeps = Parameters<typeof captureSnapshot>[0] &
  Pick<BrowserApi, 'storageGet' | 'storageSet'>;

export interface AutoSave {
  /** Capture the window's current state and write it into the project's autoSlots. */
  tick(windowId: number, projectId: string): Promise<void>;
}

/**
 * Composition layer: capture → retention → storage. The project's `name` is
 * intentionally NOT updated from the captured `windowName` — that field
 * reflects the active tab's <title>, not a stable user-set window name.
 */
export function createAutoSave(
  browser: AutoSaveDeps,
  newId: () => string,
  now: () => number,
): AutoSave {
  const storage = createStorage(browser);
  return {
    async tick(windowId, projectId) {
      const project = await storage.getProject(projectId);
      if (!project) return;
      const snap = await captureSnapshot(browser, windowId, newId, now);
      const updated = {
        ...project,
        autoSlots: rotate(project.autoSlots, snap, now()),
      };
      await storage.upsertProject(updated);
    },
  };
}
