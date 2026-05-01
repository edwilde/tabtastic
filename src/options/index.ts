import type {
  ExportAllResponse,
  ImportAllRequest,
  ImportAllResponse,
  ListProjectsResponse,
} from '../lib/messages';
import type { Project } from '../lib/types';

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
    const renameBtn = el('button', {}, ['Rename']);
    renameBtn.addEventListener('click', () => beginRename(tr, p));
    const deleteBtn = el('button', { class: 'danger' }, ['Delete']);
    deleteBtn.addEventListener('click', () => beginDelete(tr, p));
    actions.append(renameBtn, deleteBtn);
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
