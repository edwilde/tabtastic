import { bindings, browser, ensureHydrated, storage } from '../runtime';
import { updateIconsForWindow } from '../icon-state';
import { captureSnapshot } from '../../lib/capture';
import { restoreSnapshot } from '../../lib/restore';
import type {
  DeleteSnapshotRequest,
  RestoreSnapshotRequest,
  SaveNamedSnapshotRequest,
} from '../../lib/messages';
import type { Snapshot } from '../../lib/types';

type Req = SaveNamedSnapshotRequest | RestoreSnapshotRequest | DeleteSnapshotRequest;

chrome.runtime.onMessage.addListener((msg: Req, _sender, sendResponse) => {
  if (
    msg?.type !== 'saveNamedSnapshot' &&
    msg?.type !== 'restoreSnapshot' &&
    msg?.type !== 'deleteSnapshot'
  ) {
    return undefined;
  }
  (async () => {
    await ensureHydrated();
    try {
      if (msg.type === 'saveNamedSnapshot') {
        const project = await storage.getProject(msg.projectId);
        if (!project) {
          sendResponse({ ok: false, error: 'project not found' });
          return;
        }
        const wid = bindings.windowIdFor(msg.projectId);
        if (wid === undefined) {
          sendResponse({ ok: false, error: 'no window currently bound to this project' });
          return;
        }
        const snap = await captureSnapshot(
          browser,
          wid,
          () => crypto.randomUUID(),
          () => Date.now(),
        );
        const named: Snapshot = { ...snap, label: msg.label };
        project.named.unshift(named);
        await storage.upsertProject(project);
        sendResponse({ ok: true });
      } else if (msg.type === 'restoreSnapshot') {
        const project = await storage.getProject(msg.projectId);
        if (!project) {
          sendResponse({ ok: false, error: 'project not found' });
          return;
        }
        const candidates: Snapshot[] = [
          ...project.named,
          ...(['hour', 'day', 'week', 'month'] as const)
            .map((k) => project.autoSlots[k])
            .filter((s): s is Snapshot => s !== null),
        ];
        const snap = candidates.find((s) => s.id === msg.snapshotId);
        if (!snap) {
          sendResponse({ ok: false, error: 'snapshot not found' });
          return;
        }
        const result = await restoreSnapshot(browser, snap);
        // Bind the new window to this project so auto-save resumes.
        await bindings.bind(result.windowId, project.id);
        void updateIconsForWindow(result.windowId);
        sendResponse({ ok: true, windowId: result.windowId, failures: result.failures });
      } else if (msg.type === 'deleteSnapshot') {
        const project = await storage.getProject(msg.projectId);
        if (!project) {
          sendResponse({ ok: false, error: 'project not found' });
          return;
        }
        const before = project.named.length;
        project.named = project.named.filter((s) => s.id !== msg.snapshotId);
        if (project.named.length === before) {
          // Maybe an auto slot — clear it.
          (['hour', 'day', 'week', 'month'] as const).forEach((k) => {
            if (project.autoSlots[k]?.id === msg.snapshotId) project.autoSlots[k] = null;
          });
        }
        await storage.upsertProject(project);
        sendResponse({ ok: true });
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error).message });
    }
  })();
  return true;
});
