import { describe, it, expect } from 'vitest';
import { resolveImport } from '../../src/lib/import-conflict';
import type { Project } from '../../src/lib/types';

const proj = (id: string, name: string): Project => ({
  id,
  name,
  createdAt: 0,
  autoSlots: { hour: null, day: null, week: null, month: null },
  named: [],
});

describe('resolveImport', () => {
  it('imports projects with no conflicts', () => {
    const r = resolveImport([proj('a', 'A')], [proj('b', 'B')], 'overwrite');
    expect(r.imported).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.renamed).toBe(0);
    expect(r.result.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('skip strategy preserves existing on id conflict', () => {
    const existing = [proj('a', 'Original')];
    const incoming = [{ ...proj('a', 'New'), createdAt: 99 }];
    const r = resolveImport(existing, incoming, 'skip');
    expect(r.imported).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.result[0]!.name).toBe('Original');
  });

  it('overwrite strategy replaces on id conflict', () => {
    const existing = [proj('a', 'Original')];
    const incoming = [proj('a', 'New')];
    const r = resolveImport(existing, incoming, 'overwrite');
    expect(r.imported).toBe(1);
    expect(r.result[0]!.name).toBe('New');
  });

  it('rename strategy keeps both with " (imported)" suffix', () => {
    const existing = [proj('a', 'Acme')];
    const incoming = [proj('a', 'Acme')];
    const r = resolveImport(existing, incoming, 'rename');
    expect(r.renamed).toBe(1);
    expect(r.result).toHaveLength(2);
    expect(r.result.map((p) => p.name).sort()).toEqual(['Acme', 'Acme (imported)']);
  });

  it('rename increments suffix when name already taken', () => {
    const existing = [proj('a', 'Acme'), proj('b', 'Acme (imported)')];
    const incoming = [proj('a', 'Acme')];
    const r = resolveImport(existing, incoming, 'rename');
    expect(r.result.find((p) => p.name === 'Acme (imported 2)')).toBeDefined();
  });

  it('renames a no-id-conflict project that nonetheless name-collides', () => {
    const existing = [proj('a', 'Acme')];
    const incoming = [proj('z', 'Acme')]; // different id, same name
    const r = resolveImport(existing, incoming, 'rename');
    expect(r.renamed).toBe(1);
    expect(r.result.map((p) => p.name).sort()).toEqual(['Acme', 'Acme (imported)']);
  });
});
