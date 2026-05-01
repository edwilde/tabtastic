// Typed message contract between popup/options and the service worker.
// Append-only — each ticket adds its message types under a fence.

export type AnyRequest = { type: string; [k: string]: unknown };
export type AnyResponse = { ok: boolean; error?: string; [k: string]: unknown };

// === T01 ===
// (placeholder; tickets add concrete request/response unions here)
// === /T01 ===
