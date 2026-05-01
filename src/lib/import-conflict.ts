import type { Project } from './types';

export type ConflictStrategy = 'overwrite' | 'skip' | 'rename';

export type ConflictResolution = {
  imported: number;
  skipped: number;
  renamed: number;
  /** The resulting list to persist. */
  result: Project[];
};

/**
 * Pure conflict resolver for import. Given the existing project list and
 * incoming projects, returns the merged list along with counts.
 */
export function resolveImport(
  existing: Project[],
  incoming: Project[],
  strategy: ConflictStrategy,
): ConflictResolution {
  const byId = new Map(existing.map((p) => [p.id, p]));
  const byName = new Map(existing.map((p) => [p.name, p]));
  let imported = 0;
  let skipped = 0;
  let renamed = 0;

  for (const p of incoming) {
    const conflict = byId.get(p.id);
    if (!conflict) {
      // Possibly a name conflict — rename always renames; overwrite/skip pass through.
      if (byName.has(p.name) && strategy === 'rename') {
        const next = renameUntilFree(p, byName);
        byId.set(next.id, next);
        byName.set(next.name, next);
        renamed++;
        imported++;
      } else {
        byId.set(p.id, p);
        byName.set(p.name, p);
        imported++;
      }
      continue;
    }
    if (strategy === 'skip') {
      skipped++;
      continue;
    }
    if (strategy === 'overwrite') {
      byId.set(p.id, p);
      byName.set(p.name, p);
      imported++;
      continue;
    }
    // rename — id collides, so we also need a fresh id to keep both rows
    const next = { ...renameUntilFree(p, byName), id: cryptoRandomId() };
    byId.set(next.id, next);
    byName.set(next.name, next);
    renamed++;
    imported++;
  }

  return {
    imported,
    skipped,
    renamed,
    result: Array.from(byId.values()),
  };
}

function renameUntilFree(p: Project, taken: Map<string, Project>): Project {
  let suffix = 1;
  let next = `${p.name} (imported)`;
  while (taken.has(next)) {
    suffix++;
    next = `${p.name} (imported ${suffix})`;
  }
  return { ...p, name: next };
}

function cryptoRandomId(): string {
  // Tests run in node environment where crypto.randomUUID exists.
  return (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
    `imported-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
