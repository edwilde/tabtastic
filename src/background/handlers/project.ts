import { autoSave, bindings, ensureHydrated, storage } from '../runtime';
import { updateIconsForWindow } from '../icon-state';
import { bestTitleMatch } from '../../lib/match';
import type {
  DeleteProjectRequest,
  FindProjectByNameRequest,
  GetCurrentRequest,
  ListProjectsRequest,
  RebindWindowRequest,
  RenameProjectRequest,
  SaveAsProjectRequest,
  SuggestRebindRequest,
} from '../../lib/messages';

type Req =
  | GetCurrentRequest
  | SaveAsProjectRequest
  | RebindWindowRequest
  | ListProjectsRequest
  | RenameProjectRequest
  | DeleteProjectRequest
  | FindProjectByNameRequest
  | SuggestRebindRequest;

chrome.runtime.onMessage.addListener((msg: Req, _sender, sendResponse) => {
  if (
    msg?.type !== 'getCurrent' &&
    msg?.type !== 'saveAsProject' &&
    msg?.type !== 'rebindWindow' &&
    msg?.type !== 'listProjects' &&
    msg?.type !== 'renameProject' &&
    msg?.type !== 'deleteProject' &&
    msg?.type !== 'findProjectByName' &&
    msg?.type !== 'suggestRebind'
  ) {
    return undefined;
  }
  (async () => {
    await ensureHydrated();
    try {
      if (msg.type === 'getCurrent') {
        // T22 — populate: true so `title` is hydrated. When the user has set
        // Chrome's "Name window" value, the OS title prefix surfaces through
        // this field; otherwise it falls back to the active tab's title.
        const win = await chrome.windows.getLastFocused({ populate: true });
        const wid = win.id;
        const projectId = wid !== undefined ? bindings.projectIdFor(wid) : undefined;
        const project = projectId ? await storage.getProject(projectId) : undefined;
        sendResponse({
          ok: true,
          windowId: wid,
          windowTitle: (win as unknown as { title?: string }).title ?? '',
          projectId,
          project,
        });
      } else if (msg.type === 'saveAsProject') {
        // Rebind path is handled separately via rebindWindow.
        const id = crypto.randomUUID();
        const project = {
          id,
          name: msg.name,
          createdAt: Date.now(),
          autoSlots: { hour: null, day: null, week: null, month: null },
          named: [],
        };
        await storage.upsertProject(project);
        await bindings.bind(msg.windowId, id);
        await autoSave.tick(msg.windowId, id);
        void updateIconsForWindow(msg.windowId);
        sendResponse({ ok: true, projectId: id });
      } else if (msg.type === 'rebindWindow') {
        const project = await storage.getProject(msg.projectId);
        if (!project) {
          sendResponse({ ok: false, error: 'project not found' });
          return;
        }
        // Drop any existing binding of this project, then bind the window.
        await bindings.unbindProject(msg.projectId);
        await bindings.bind(msg.windowId, msg.projectId);
        await autoSave.tick(msg.windowId, msg.projectId);
        void updateIconsForWindow(msg.windowId);
        sendResponse({ ok: true });
      } else if (msg.type === 'listProjects') {
        const projects = await storage.listProjects();
        sendResponse({ ok: true, projects });
      } else if (msg.type === 'renameProject') {
        const p = await storage.getProject(msg.projectId);
        if (!p) {
          sendResponse({ ok: false, error: 'project not found' });
          return;
        }
        p.name = msg.name;
        await storage.upsertProject(p);
        sendResponse({ ok: true });
      } else if (msg.type === 'deleteProject') {
        const wid = bindings.windowIdFor(msg.projectId);
        await storage.deleteProject(msg.projectId);
        await bindings.unbindProject(msg.projectId);
        if (wid !== undefined) void updateIconsForWindow(wid);
        sendResponse({ ok: true });
      } else if (msg.type === 'findProjectByName') {
        const all = await storage.listProjects();
        const project = all.find((p) => p.name === msg.name) ?? null;
        sendResponse({ ok: true, project });
      } else if (msg.type === 'suggestRebind') {
        const win = await chrome.windows.get(msg.windowId, { populate: true });
        const title = (win as unknown as { title?: string }).title ?? '';
        const all = await storage.listProjects();
        // Skip projects already bound to a live window — first-wins binding
        // semantics mean re-binding them would no-op anyway.
        const candidates = all.filter((p) => bindings.windowIdFor(p.id) === undefined);
        const suggestion = bestTitleMatch(title, candidates);
        sendResponse({ ok: true, suggestion });
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error).message });
    }
  })();
  return true; // async response
});
