import type {
  GetCurrentResponse,
  RestoreSnapshotResponse,
  SaveAsProjectResponse,
  FindProjectByNameResponse,
} from '../lib/messages';
import type { Project, Snapshot, RestoreFailure } from '../lib/types';

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
    else if (k === 'dataset' && v) Object.assign(node.dataset, v);
    else (node as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of children) node.append(c);
  return node;
}

function fmtAge(t: number): string {
  const ms = Date.now() - t;
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

const root = () => document.getElementById('root')!;

async function render(): Promise<void> {
  const ctx = await send<GetCurrentResponse>({ type: 'getCurrent' });
  if (!ctx.ok) {
    root().textContent = 'Error loading project info.';
    return;
  }
  if (!ctx.projectId || !ctx.project) {
    renderUnboundView(ctx.windowId, ctx.windowTitle ?? '');
  } else {
    renderProjectView(ctx.project, ctx.windowTitle ?? '');
  }
}

function renderUnboundView(windowId: number | undefined, windowTitle: string): void {
  const r = root();
  r.replaceChildren();
  r.append(el('h1', {}, ['Tabtastic!']));
  r.append(el('div', { class: 'window-meta' }, ['No project bound to this window']));

  const input = el('input', {
    type: 'text',
    placeholder: 'Project name',
    value: windowTitle,
  }) as HTMLInputElement;
  r.append(input);

  const conflictBanner = el('div', { class: 'banner', hidden: true } as unknown as HTMLDivElement);
  r.append(conflictBanner);

  let lastFoundProjectId: string | null = null;

  const checkName = async (): Promise<void> => {
    const name = input.value.trim();
    conflictBanner.replaceChildren();
    conflictBanner.hidden = true;
    lastFoundProjectId = null;
    if (!name) return;
    const r2 = await send<FindProjectByNameResponse>({ type: 'findProjectByName', name });
    if (r2.ok && r2.project) {
      lastFoundProjectId = r2.project.id;
      conflictBanner.hidden = false;
      conflictBanner.append(
        el('div', {}, [
          `A project named "${r2.project.name}" already exists. Rebind this window to it (keeps existing snapshots)?`,
        ]),
      );
      const rebindBtn = el('button', {}, ['Rebind to existing']);
      rebindBtn.addEventListener('click', async () => {
        if (windowId === undefined || !lastFoundProjectId) return;
        await send({ type: 'rebindWindow', windowId, projectId: lastFoundProjectId });
        render();
      });
      conflictBanner.append(rebindBtn);
    }
  };
  input.addEventListener('input', () => void checkName());
  void checkName();

  const saveBtn = el('button', { class: 'primary' }, ['Save this window as a project']);
  saveBtn.addEventListener('click', async () => {
    const name = input.value.trim();
    if (!name || windowId === undefined) return;
    const r2 = await send<SaveAsProjectResponse>({ type: 'saveAsProject', windowId, name });
    if (r2.ok) render();
    else alertError(r2.error);
  });
  r.append(saveBtn);

  const opts = el('a', { class: 'gear', href: '#' }, ['Manage all projects →']);
  opts.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  const optsRow = el('div', { class: 'notice' });
  optsRow.append(opts);
  r.append(optsRow);
}

function renderProjectView(project: Project, windowTitle: string): void {
  const r = root();
  r.replaceChildren();

  const heading = el('h1', {}, [project.name]);
  const gear = el('a', { class: 'gear', href: '#', title: 'Manage all projects' }, ['⚙']);
  gear.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  heading.append(gear);
  r.append(heading);
  r.append(el('div', { class: 'window-meta' }, [`Window: "${windowTitle}"`]));

  const auto = (['hour', 'day', 'week', 'month'] as const)
    .map((k) => project.autoSlots[k])
    .filter((s): s is Snapshot => s !== null);
  const lastSave = Math.max(0, ...auto.map((s) => s.takenAt), ...project.named.map((s) => s.takenAt));
  if (lastSave) {
    r.append(el('div', { class: 'window-meta' }, [`Last save: ${fmtAge(lastSave)}`]));
  }

  const saveBtn = el('button', { class: 'primary' }, ['+ Save Named Snapshot']);
  r.append(saveBtn);

  const snapForm = el('div', { hidden: true } as unknown as HTMLDivElement);
  const labelInput = el('input', {
    type: 'text',
    placeholder: 'Snapshot name (e.g. "clean baseline")',
  }) as HTMLInputElement;
  const confirmBtn = el('button', { class: 'primary' }, ['Save']);
  const cancelBtn = el('button', {}, ['Cancel']);
  const formActions = el('div', { class: 'actions' });
  formActions.append(confirmBtn, cancelBtn);
  snapForm.append(labelInput, formActions);
  r.append(snapForm);

  saveBtn.addEventListener('click', () => {
    snapForm.hidden = false;
    saveBtn.hidden = true;
    labelInput.focus();
  });
  cancelBtn.addEventListener('click', () => {
    snapForm.hidden = true;
    saveBtn.hidden = false;
    labelInput.value = '';
  });
  confirmBtn.addEventListener('click', async () => {
    const label = labelInput.value.trim();
    if (!label) return;
    confirmBtn.classList.add('celebrate');
    await send({ type: 'saveNamedSnapshot', projectId: project.id, label });
    // Brief celebration before re-render so the user sees the affordance fire.
    await new Promise((r) => setTimeout(r, 180));
    render();
  });
  labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmBtn.click();
    if (e.key === 'Escape') cancelBtn.click();
  });

  r.append(el('div', { class: 'section' }, ['Auto']));
  if (auto.length === 0) {
    const e = el('div', { class: 'empty first-time' });
    e.append(el('strong', {}, ['Auto-saves coming soon']));
    e.append(document.createTextNode('Make a tab change and Tabtastic! takes a snapshot in the background.'));
    r.append(e);
  }
  for (const s of auto) {
    r.append(makeSnapRow(project.id, s, fmtAge(s.takenAt), false));
  }

  r.append(el('div', { class: 'section' }, ['Named']));
  if (project.named.length === 0)
    r.append(el('div', { class: 'empty' }, ['No named snapshots']));
  for (const s of project.named) {
    r.append(makeSnapRow(project.id, s, s.label ?? '(unnamed)', true));
  }
}

function makeSnapRow(
  projectId: string,
  snap: Snapshot,
  label: string,
  deletable: boolean,
): HTMLDivElement {
  const row = el('div', { class: 'row' });
  row.append(el('span', { class: 'label' }, [label]));
  const restoreBtn = el('button', {}, ['Restore']);
  restoreBtn.addEventListener('click', async () => {
    restoreBtn.disabled = true;
    restoreBtn.textContent = 'Restoring…';
    const r = await send<RestoreSnapshotResponse>({
      type: 'restoreSnapshot',
      projectId,
      snapshotId: snap.id,
    });
    restoreBtn.disabled = false;
    restoreBtn.textContent = 'Restore';
    if (!r.ok) {
      alertError(r.error);
      return;
    }
    if (r.failures.length > 0) renderFailurePanel(r.failures);
    else window.close();
  });
  row.append(restoreBtn);
  if (deletable) {
    const delBtn = el('button', { class: 'danger', title: 'Delete snapshot' }, ['×']);
    delBtn.addEventListener('click', async () => {
      const banner = el('div', { class: 'banner' }, [
        `Delete "${label}"?`,
      ]);
      const yes = el('button', { class: 'danger' }, ['Delete']);
      const no = el('button', {}, ['Cancel']);
      const acts = el('div', { class: 'actions' });
      acts.append(yes, no);
      banner.append(acts);
      row.append(banner);
      yes.addEventListener('click', async () => {
        await send({ type: 'deleteSnapshot', projectId, snapshotId: snap.id });
        render();
      });
      no.addEventListener('click', () => banner.remove());
    });
    row.append(delBtn);
  }
  return row;
}

function renderFailurePanel(failures: RestoreFailure[]): void {
  const panel = el('div', { class: 'failure-panel' });
  panel.append(el('h2', {}, ['Some tabs could not be restored']));
  const ul = el('ul');
  for (const f of failures) {
    ul.append(el('li', {}, [`${f.url} — ${f.reason}`]));
  }
  panel.append(ul);
  root().append(panel);
}

function alertError(msg: string): void {
  const banner = el('div', { class: 'banner' }, [`Error: ${msg}`]);
  root().append(banner);
}

void render();
