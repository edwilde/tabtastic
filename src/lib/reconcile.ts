import { bestTitleMatch } from './match';
import type { Project } from './types';

export type WindowInfo = { id: number; title: string };

/**
 * Decide which unbound windows should auto-bind to a project. Pure: callers
 * supply the current windows, the project list, and the live binding state;
 * this returns the binds to apply.
 *
 * Only strong `name-window` matches qualify — i.e. the window's title carries
 * the project name as a Chrome "Name window" prefix. The looser
 * `title-contains` heuristic stays a popup-only suggestion so we never silently
 * mis-bind a window to the wrong project. A project already bound to a live
 * window is skipped (first-wins), and within a single pass no project is
 * assigned to two windows.
 */
export function planReconcile(
  windows: WindowInfo[],
  projects: Project[],
  boundWindowIds: ReadonlySet<number>,
  boundProjectIds: ReadonlySet<string>,
): { windowId: number; projectId: string }[] {
  const result: { windowId: number; projectId: string }[] = [];
  const taken = new Set(boundProjectIds);
  for (const win of windows) {
    if (boundWindowIds.has(win.id)) continue;
    const candidates = projects.filter((p) => !taken.has(p.id));
    const match = bestTitleMatch(win.title, candidates);
    if (!match || match.reason !== 'name-window') continue;
    result.push({ windowId: win.id, projectId: match.project.id });
    taken.add(match.project.id);
  }
  return result;
}
