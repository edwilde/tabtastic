// Typed message contract between popup/options and the service worker.
// Append-only — each ticket adds its message types under a fence.

export type AnyRequest = { type: string; [k: string]: unknown };
export type AnyResponse = { ok: boolean; error?: string; [k: string]: unknown };

// === T06 — popup messages ===
import type { Project, Snapshot, RestoreFailure } from './types';

export type GetCurrentRequest = { type: 'getCurrent' };
export type GetCurrentResponse = {
  ok: true;
  windowId?: number;
  windowTitle?: string;
  projectId?: string;
  project?: Project;
};

export type SaveAsProjectRequest = { type: 'saveAsProject'; windowId: number; name: string };
export type SaveAsProjectResponse = { ok: true; projectId: string } | { ok: false; error: string };

export type RebindWindowRequest = { type: 'rebindWindow'; windowId: number; projectId: string };
export type RebindWindowResponse = { ok: true } | { ok: false; error: string };

export type SaveNamedSnapshotRequest = {
  type: 'saveNamedSnapshot';
  projectId: string;
  label: string;
};
export type SaveNamedSnapshotResponse = { ok: true } | { ok: false; error: string };

export type RestoreSnapshotRequest = {
  type: 'restoreSnapshot';
  projectId: string;
  snapshotId: string;
};
export type RestoreSnapshotResponse =
  | { ok: true; windowId: number; failures: RestoreFailure[] }
  | { ok: false; error: string };

export type DeleteSnapshotRequest = {
  type: 'deleteSnapshot';
  projectId: string;
  snapshotId: string;
};
export type DeleteSnapshotResponse = { ok: true } | { ok: false; error: string };

export type ListProjectsRequest = { type: 'listProjects' };
export type ListProjectsResponse = { ok: true; projects: Project[] };

export type RenameProjectRequest = { type: 'renameProject'; projectId: string; name: string };
export type RenameProjectResponse = { ok: true } | { ok: false; error: string };

export type DeleteProjectRequest = { type: 'deleteProject'; projectId: string };
export type DeleteProjectResponse = { ok: true } | { ok: false; error: string };

export type FindProjectByNameRequest = { type: 'findProjectByName'; name: string };
export type FindProjectByNameResponse = { ok: true; project: Project | null };

export type SuggestRebindRequest = { type: 'suggestRebind'; windowId: number };
export type SuggestRebindResponse = {
  ok: true;
  // Best single suggestion when we have high confidence (window title carries
  // the project name via Chrome's "Name window"). The popup shows this above
  // the form as a one-click rebind.
  suggestion: { project: Project; reason: 'name-window' | 'title-contains' } | null;
};
// === /T06 ===

// === T13/T14 — export/import ===
export type ExportAllRequest = { type: 'exportAll' };
export type ExportAllResponse = { ok: true; data: { version: 1; projects: Project[] } };

export type ImportAllRequest = {
  type: 'importAll';
  data: { version: 1; projects: Project[] };
  strategy: 'overwrite' | 'skip' | 'rename';
};
export type ImportAllResponse =
  | { ok: true; imported: number; skipped: number; renamed: number }
  | { ok: false; error: string };
// === /T13/T14 ===

// Helper alias for re-export usage.
export type AnySnapshot = Snapshot;
