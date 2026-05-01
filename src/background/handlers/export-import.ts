import { storage } from '../runtime';
import { resolveImport } from '../../lib/import-conflict';
import type { ExportAllRequest, ImportAllRequest } from '../../lib/messages';

type Req = ExportAllRequest | ImportAllRequest;

chrome.runtime.onMessage.addListener((msg: Req, _sender, sendResponse) => {
  if (msg?.type !== 'exportAll' && msg?.type !== 'importAll') return undefined;
  (async () => {
    try {
      if (msg.type === 'exportAll') {
        const projects = await storage.listProjects();
        sendResponse({ ok: true, data: { version: 1 as const, projects } });
      } else {
        if (msg.data?.version !== 1 || !Array.isArray(msg.data.projects)) {
          sendResponse({ ok: false, error: 'invalid import file (expected version 1)' });
          return;
        }
        const existing = await storage.listProjects();
        const r = resolveImport(existing, msg.data.projects, msg.strategy);
        await storage.replaceAll(r.result);
        sendResponse({
          ok: true,
          imported: r.imported,
          skipped: r.skipped,
          renamed: r.renamed,
        });
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error).message });
    }
  })();
  return true;
});
