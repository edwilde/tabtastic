import type {
  ExportAllResponse,
  ImportAllRequest,
  ImportAllResponse,
  ListProjectsResponse,
  RestoreSnapshotResponse,
} from '../lib/messages';
import type { Project, Snapshot } from '../lib/types';

function send<T>(msg: unknown): Promise<T> {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve as (v: T) => void));
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v as string;
    else (node as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of children) node.append(c);
  return node;
}

function fmtTime(t: number): string {
  if (!t) return '—';
  return new Date(t).toLocaleString();
}

function lastSaveOf(p: Project): number {
  const auto = (['hour', 'day', 'week', 'month'] as const)
    .map((k) => p.autoSlots[k]?.takenAt ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);
  const named = p.named.map((s) => s.takenAt).reduce((a, b) => Math.max(a, b), 0);
  return Math.max(auto, named);
}

function autoCount(p: Project): number {
  return (['hour', 'day', 'week', 'month'] as const).filter((k) => p.autoSlots[k]).length;
}

const list = () => document.getElementById('list')!;

async function render(banner?: string): Promise<void> {
  const r = await send<ListProjectsResponse>({ type: 'listProjects' });
  list().replaceChildren();

  if (banner) {
    const b = el('div', { class: 'banner' }, [banner]);
    list().append(b);
  }

  if (!r.ok || r.projects.length === 0) {
    const empty = el('div', { class: 'empty' });
    empty.append(el('h2', {}, ['No projects yet']));
    empty.append(
      el('p', {}, ['Open a project window in Chrome and use the Tabtastic! popup to save it.']),
    );
    list().append(empty);
    return;
  }

  const table = el('table');
  const thead = el('thead');
  const headRow = el('tr');
  for (const h of ['Name', 'Auto', 'Named', 'Last save', '']) {
    headRow.append(el('th', {}, [h]));
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = el('tbody');
  for (const p of r.projects) {
    const tr = el('tr');
    tr.dataset.id = p.id;
    const nameTd = el('td');
    const nameSpan = el('span', { class: 'project-name' }, [p.name]);
    nameTd.append(nameSpan);
    tr.append(nameTd);
    tr.append(el('td', {}, [`${autoCount(p)}/4`]));
    tr.append(el('td', {}, [String(p.named.length)]));
    tr.append(el('td', {}, [fmtTime(lastSaveOf(p))]));

    const actions = el('td', { class: 'actions' });
    const restoreBtn = el('button', {}, ['Restore']);
    restoreBtn.addEventListener('click', () => toggleRestorePanel(tr, p, restoreBtn));
    const renameBtn = el('button', {}, ['Rename']);
    renameBtn.addEventListener('click', () => beginRename(tr, p));
    const deleteBtn = el('button', { class: 'danger' }, ['Delete']);
    deleteBtn.addEventListener('click', () => beginDelete(tr, p));
    actions.append(restoreBtn, renameBtn, deleteBtn);
    tr.append(actions);

    tbody.append(tr);
  }
  table.append(tbody);
  list().append(table);
}

function beginRename(tr: HTMLTableRowElement, p: Project): void {
  const nameTd = tr.cells[0]!;
  const input = el('input', { type: 'text', value: p.name }) as HTMLInputElement;
  nameTd.replaceChildren(input);
  input.focus();
  input.select();
  const finish = async (commit: boolean): Promise<void> => {
    if (commit && input.value.trim() && input.value !== p.name) {
      await send({ type: 'renameProject', projectId: p.id, name: input.value.trim() });
    }
    render();
  };
  input.addEventListener('blur', () => void finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void finish(true);
    if (e.key === 'Escape') void finish(false);
  });
}

// T24 — expandable restore picker per project row. Shows every snapshot
// (named first, then auto slots) with an Open button per entry.
function toggleRestorePanel(
  tr: HTMLTableRowElement,
  p: Project,
  btn: HTMLButtonElement,
): void {
  const next = tr.nextElementSibling as HTMLTableRowElement | null;
  if (next?.classList.contains('restore-panel')) {
    next.remove();
    btn.textContent = 'Restore';
    return;
  }
  btn.textContent = 'Close';
  const panelRow = document.createElement('tr');
  panelRow.className = 'restore-panel';
  const cell = document.createElement('td');
  cell.colSpan = tr.cells.length;
  panelRow.append(cell);

  const inner = el('div', { class: 'restore-panel-inner' });

  const named = p.named;
  const autoEntries = (['hour', 'day', 'week', 'month'] as const)
    .map((slot) => ({ slot, snap: p.autoSlots[slot] }))
    .filter((s): s is { slot: 'hour' | 'day' | 'week' | 'month'; snap: Snapshot } => !!s.snap);

  if (named.length === 0 && autoEntries.length === 0) {
    inner.append(el('div', { class: 'restore-empty' }, ['No snapshots yet for this project.']));
  } else {
    if (named.length > 0) {
      inner.append(el('div', { class: 'restore-heading' }, ['Named snapshots']));
      for (const s of named) {
        inner.append(makeSnapshotEntry(p.id, s, s.label ?? '(unnamed)', fmtTime(s.takenAt)));
      }
    }
    if (autoEntries.length > 0) {
      inner.append(el('div', { class: 'restore-heading' }, ['Auto-saves']));
      for (const { slot, snap } of autoEntries) {
        const slotLabel = slot.charAt(0).toUpperCase() + slot.slice(1);
        inner.append(makeSnapshotEntry(p.id, snap, slotLabel, fmtTime(snap.takenAt)));
      }
    }
  }

  cell.append(inner);
  tr.after(panelRow);
}

function makeSnapshotEntry(
  projectId: string,
  snap: Snapshot,
  label: string,
  taken: string,
): HTMLDivElement {
  const row = el('div', { class: 'restore-entry' });
  row.append(el('span', { class: 'restore-entry-label' }, [label]));
  row.append(el('span', { class: 'restore-entry-time' }, [taken]));
  const open = el('button', {}, ['Open in new window']);
  open.addEventListener('click', async () => {
    open.disabled = true;
    open.textContent = 'Opening…';
    const r = await send<RestoreSnapshotResponse>({
      type: 'restoreSnapshot',
      projectId,
      snapshotId: snap.id,
    });
    open.disabled = false;
    if (r.ok) {
      open.textContent = 'Opened ✓';
      if (r.failures.length > 0) {
        row.append(
          el('div', { class: 'restore-entry-failures' }, [
            `${r.failures.length} tab${r.failures.length === 1 ? '' : 's'} could not be restored.`,
          ]),
        );
      }
    } else {
      open.textContent = 'Open in new window';
      row.append(el('div', { class: 'restore-entry-failures' }, [`Error: ${r.error}`]));
    }
  });
  row.append(open);
  return row;
}

function beginDelete(tr: HTMLTableRowElement, p: Project): void {
  // Inline confirmation row.
  const actionsCell = tr.cells[tr.cells.length - 1]!;
  actionsCell.replaceChildren();
  const confirm = el('button', { class: 'danger' }, ['Confirm delete']);
  const cancel = el('button', {}, ['Cancel']);
  actionsCell.append(confirm, cancel);
  confirm.addEventListener('click', async () => {
    await send({ type: 'deleteProject', projectId: p.id });
    render();
  });
  cancel.addEventListener('click', () => render());
}

async function exportAll(): Promise<void> {
  const r = await send<ExportAllResponse>({ type: 'exportAll' });
  const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tabtastic-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importFile(file: File): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    render('Import failed: file is not valid JSON.');
    return;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { version?: number }).version !== 1
  ) {
    render('Import failed: expected a Tabtastic! v1 export file.');
    return;
  }

  const dialog = document.getElementById('strategy-dialog') as HTMLDialogElement;
  dialog.showModal();
  dialog.addEventListener(
    'close',
    async () => {
      if (dialog.returnValue !== 'ok') return;
      const strategy = (
        dialog.querySelector('input[name="strategy"]:checked') as HTMLInputElement
      ).value as ImportAllRequest['strategy'];
      const r = await send<ImportAllResponse>({
        type: 'importAll',
        data: parsed as ImportAllRequest['data'],
        strategy,
      });
      if (r.ok) {
        render(
          `Import complete: ${r.imported} imported, ${r.skipped} skipped, ${r.renamed} renamed.`,
        );
      } else {
        render(`Import failed: ${r.error}`);
      }
    },
    { once: true },
  );
}

document.getElementById('export')!.addEventListener('click', () => void exportAll());
document.getElementById('importBtn')!.addEventListener('click', () => {
  (document.getElementById('importFile') as HTMLInputElement).click();
});
document.getElementById('importFile')!.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void importFile(file);
});

void render();
