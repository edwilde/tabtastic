// T28 — auto-bind windows to their project by Chrome "Name window" title.
// Bindings live in chrome.storage.session and are wiped on browser restart,
// so after a restart every window starts unbound. This pass re-links any
// unbound window whose title strongly matches a project name, with no popup
// interaction — covering the common "restart unlinked everything" case.

import { autoSave, bindings, ensureHydrated, storage } from './runtime';
import { updateIconsForWindow } from './icon-state';
import { planReconcile, type WindowInfo } from '../lib/reconcile';

export async function reconcileBindings(): Promise<void> {
  await ensureHydrated();

  let wins: chrome.windows.Window[];
  try {
    // populate: true hydrates `title`, which carries the "Name window" prefix.
    wins = await chrome.windows.getAll({ populate: true });
  } catch {
    return; // no windows / API unavailable — nothing to reconcile
  }

  const windows: WindowInfo[] = wins
    .filter((w): w is chrome.windows.Window & { id: number } => w.id !== undefined)
    .map((w) => ({ id: w.id, title: (w as unknown as { title?: string }).title ?? '' }));

  const projects = await storage.listProjects();
  const boundWindowIds = new Set(bindings.allBoundWindows());
  const boundProjectIds = new Set(
    [...boundWindowIds]
      .map((wid) => bindings.projectIdFor(wid))
      .filter((pid): pid is string => pid !== undefined),
  );

  const plan = planReconcile(windows, projects, boundWindowIds, boundProjectIds);
  for (const { windowId, projectId } of plan) {
    await bindings.bind(windowId, projectId);
    await autoSave.tick(windowId, projectId);
    void updateIconsForWindow(windowId);
  }
}
