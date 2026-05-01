// Shared type definitions. Append-only — each ticket adds its types under a fence.

// === T02 — Snapshot data model ===
export type TabSnap = { url: string; title: string };

export type GroupColor =
  | 'grey'
  | 'blue'
  | 'red'
  | 'yellow'
  | 'green'
  | 'pink'
  | 'purple'
  | 'cyan'
  | 'orange';

export type GroupSnap = {
  title: string;
  color: GroupColor;
  collapsed: boolean;
  tabs: TabSnap[];
};

export type Snapshot = {
  id: string;
  label?: string;
  takenAt: number;
  windowName: string;
  groups: GroupSnap[];
  ungroupedTabs: TabSnap[];
};

export type AutoSlots = {
  hour: Snapshot | null;
  day: Snapshot | null;
  week: Snapshot | null;
  month: Snapshot | null;
};

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  autoSlots: AutoSlots;
  named: Snapshot[];
};

export type ProjectsExport = { version: 1; projects: Project[] };
// === /T02 ===

// === T04 — Restore result ===
export type RestoreFailure = { url: string; reason: string };
export type RestoreResult = { windowId: number; failures: RestoreFailure[] };
// === /T04 ===
