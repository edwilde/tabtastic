// Thin wrapper around the chrome.* APIs so tests can substitute a fake.
// Append-only — each ticket adds the methods it needs under a fence.

export interface BrowserApi {
  // === T01 ===
  // (placeholder; tickets add wrapper methods here)
  // === /T01 ===
}

export function createBrowser(): BrowserApi {
  return {
    // === T01 ===
    // === /T01 ===
  };
}
