// Minimal global.chrome stub so modules referencing chrome.* at module load
// don't throw ReferenceError during Vitest collection. Tests must pass fakes
// to wrapper-creating functions; calling chrome.* via this stub throws.

const trap = () => {
  throw new Error('chrome.* called in tests — pass a fake BrowserApi instead');
};

const handler: ProxyHandler<object> = {
  get: () => new Proxy(trap, handler),
  apply: trap,
};

(globalThis as { chrome?: unknown }).chrome = new Proxy({}, handler);
