import { describe, it, expect } from 'vitest';
import { createBindings } from '../../src/lib/bindings';

function fakeSession() {
  const store = new Map<string, unknown>();
  return {
    store,
    deps: {
      sessionStorageGet: async <T>(key: string) => store.get(key) as T | undefined,
      sessionStorageSet: async (key: string, value: unknown) => {
        store.set(key, value);
      },
    },
  };
}

describe('bindings', () => {
  it('binds and looks up by windowId', async () => {
    const { deps } = fakeSession();
    const b = createBindings(deps);
    await b.bind(10, 'p1');
    expect(b.projectIdFor(10)).toBe('p1');
    expect(b.windowIdFor('p1')).toBe(10);
  });

  it('first-wins on project collision', async () => {
    const { deps } = fakeSession();
    const b = createBindings(deps);
    await b.bind(10, 'p1');
    await b.bind(20, 'p1');
    expect(b.windowIdFor('p1')).toBe(10);
    expect(b.projectIdFor(20)).toBeUndefined();
  });

  it('unbindWindow clears both directions', async () => {
    const { deps } = fakeSession();
    const b = createBindings(deps);
    await b.bind(10, 'p1');
    await b.unbindWindow(10);
    expect(b.projectIdFor(10)).toBeUndefined();
    expect(b.windowIdFor('p1')).toBeUndefined();
  });

  it('unbindProject clears both directions', async () => {
    const { deps } = fakeSession();
    const b = createBindings(deps);
    await b.bind(10, 'p1');
    await b.unbindProject('p1');
    expect(b.projectIdFor(10)).toBeUndefined();
    expect(b.windowIdFor('p1')).toBeUndefined();
  });

  it('persists to session storage and rehydrates', async () => {
    const session = fakeSession();
    const b1 = createBindings(session.deps);
    await b1.bind(10, 'p1');
    await b1.bind(20, 'p2');

    const b2 = createBindings(session.deps);
    await b2.hydrate();
    expect(b2.projectIdFor(10)).toBe('p1');
    expect(b2.projectIdFor(20)).toBe('p2');
    expect(b2.allBoundWindows().sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it('hydrate clears prior in-memory state', async () => {
    const session = fakeSession();
    const b = createBindings(session.deps);
    await b.bind(10, 'p1');
    // Wipe storage out-of-band, then hydrate.
    session.store.delete('bindings');
    await b.hydrate();
    expect(b.projectIdFor(10)).toBeUndefined();
  });

  it('allBoundWindows returns all window ids', async () => {
    const { deps } = fakeSession();
    const b = createBindings(deps);
    await b.bind(1, 'p1');
    await b.bind(2, 'p2');
    expect(b.allBoundWindows().sort((a, b) => a - b)).toEqual([1, 2]);
  });
});
