import { autoSave, bindings, debouncer, ensureHydrated } from '../runtime';

debouncer.onFire(async (key) => {
  await ensureHydrated();
  const wid = Number(key);
  if (!Number.isFinite(wid)) return;
  const pid = bindings.projectIdFor(wid);
  if (!pid) return;
  await autoSave.tick(wid, pid);
});
