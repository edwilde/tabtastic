import type {
  GetCurrentResponse,
  ListProjectsResponse,
  RestoreSnapshotResponse,
  SaveAsProjectResponse,
  FindProjectByNameResponse,
  SuggestRebindResponse,
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

async function renderUnboundView(windowId: number | undefined, windowTitle: string): Promise<void> {
  const r = root();
  r.replaceChildren();
  r.append(el('h1', {}, ['Tabtastic!']));
  r.append(el('div', { class: 'window-meta' }, ['No project bound to this window']));

  // Fetch existing projects + a title-based suggestion in parallel so the
  // dropdown and the auto-suggest banner can render in one pass.
  const [listResp, sugResp] = await Promise.all([
    send<ListProjectsResponse>({ type: 'listProjects' }),
    windowId !== undefined
      ? send<SuggestRebindResponse>({ type: 'suggestRebind', windowId })
      : Promise.resolve({ ok: true, suggestion: null } as SuggestRebindResponse),
  ]);
  const allProjects = listResp.ok ? listResp.projects : [];
  const suggestion = sugResp.ok ? sugResp.suggestion : null;

  // Strong suggestion banner — shown above the form for one-click rebind when
  // the window title already carries the project name (Chrome "Name window").
  if (suggestion && windowId !== undefined) {
    const banner = el('div', { class: 'banner' });
    const lead =
      suggestion.reason === 'name-window'
        ? `This window is named "${suggestion.project.name}". Rebind to that project?`
        : `Looks like project "${suggestion.project.name}". Rebind this window to it?`;
    banner.append(el('div', {}, [lead]));
    const rebindBtn = el('button', { class: 'primary' }, [`Rebind to "${suggestion.project.name}"`]);
    rebindBtn.addEventListener('click', async () => {
      await send({ type: 'rebindWindow', windowId, projectId: suggestion.project.id });
      render();
    });
    banner.append(rebindBtn);
    r.append(banner);
  }

  // Combobox: free text + datalist of every existing project. Picking an
  // existing name flips the primary button to "Rebind"; a new name keeps it
  // as "Save as new project".
  const listId = 'tt-project-names';
  const input = el('input', {
    type: 'text',
    placeholder: 'Project name',
    value: windowTitle,
    // Wire the input to the datalist below.
    autocomplete: 'off',
  }) as HTMLInputElement;
  input.setAttribute('list', listId);
  r.append(input);

  const datalist = document.createElement('datalist');
  datalist.id = listId;
  for (const p of allProjects) {
    const opt = document.createElement('option');
    opt.value = p.name;
    datalist.append(opt);
  }
  r.append(datalist);

  // Hint listing existing projects when there are any but the user hasn't
  // typed — makes the dropdown affordance discoverable.
  if (allProjects.length > 0) {
    r.append(
      el('div', { class: 'window-meta hint' }, [
        `Tip: pick an existing project from the dropdown to relink this window.`,
      ]),
    );
  }

  const conflictBanner = el('div', { class: 'banner', hidden: true } as unknown as HTMLDivElement);
  r.append(conflictBanner);

  const primaryBtn = el('button', { class: 'primary' }, ['Save this window as a project']);
  r.append(primaryBtn);

  let matchedProjectId: string | null = null;

  const updateMatch = async (): Promise<void> => {
    const name = input.value.trim();
    conflictBanner.replaceChildren();
    conflictBanner.hidden = true;
    matchedProjectId = null;
    primaryBtn.textContent = 'Save this window as a project';
    if (!name) return;
    // Fast local hit first (covers the dropdown-selection path without a
    // round-trip), then a server check for canonical casing/whitespace.
    const local = allProjects.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (local) {
      matchedProjectId = local.id;
      primaryBtn.textContent = `Rebind to "${local.name}"`;
      return;
    }
    const r2 = await send<FindProjectByNameResponse>({ type: 'findProjectByName', name });
    if (r2.ok && r2.project) {
      matchedProjectId = r2.project.id;
      primaryBtn.textContent = `Rebind to "${r2.project.name}"`;
    }
  };
  input.addEventListener('input', () => void updateMatch());
  void updateMatch();

  primaryBtn.addEventListener('click', async () => {
    const name = input.value.trim();
    if (!name || windowId === undefined) return;
    if (matchedProjectId) {
      await send({ type: 'rebindWindow', windowId, projectId: matchedProjectId });
      render();
      return;
    }
    const r2 = await send<SaveAsProjectResponse>({ type: 'saveAsProject', windowId, name });
    if (r2.ok) render();
    else alertError(r2.error);
  });

  const opts = el('a', { class: 'options-link', href: '#' }, ['Manage all projects →']);
  opts.addEventListener('click', (e) => {
    e.preventDefault();
    openOptionsRobustly();
  });
  const optsRow = el('div', { class: 'notice' });
  optsRow.append(opts);
  r.append(optsRow);
}

// T25 — robustly open the options page. `chrome.runtime.openOptionsPage()`
// can no-op silently if the popup tears down mid-call. Fall back to opening
// the options HTML in a new tab.
function openOptionsRobustly(): void {
  try {
    if (typeof chrome.runtime.openOptionsPage === 'function') {
      chrome.runtime.openOptionsPage(() => {
        if (chrome.runtime.lastError) openOptionsViaTabs();
      });
      return;
    }
  } catch {
    /* fall through */
  }
  openOptionsViaTabs();
}

function openOptionsViaTabs(): void {
  const url = chrome.runtime.getURL('src/options/index.html');
  void chrome.tabs.create({ url });
}

function renderProjectView(project: Project, windowTitle: string): void {
  const r = root();
  r.replaceChildren();

  const heading = el('h1', {}, [project.name]);
  const gear = el(
    'button',
    {
      class: 'gear',
      type: 'button',
      title: 'Manage all projects',
      'aria-label': 'Manage all projects',
    } as Partial<HTMLButtonElement> & { class?: string; 'aria-label'?: string },
    ['⚙'],
  );
  gear.addEventListener('click', () => openOptionsRobustly());
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
    // T23 — show a notice nudging the user to set Chrome's "Name window" since
    // the extension API can't set it programmatically. Close on dismiss.
    renderRestoreNotice(projectId, r.failures);
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

// T23 — name-window restoration notice. After a restore, the new window is
// already bound to the project (so the popup will show the right name when
// reopened), but Chrome's MV3 extension API can't set the OS-level window
// name programmatically. Best we can do is tell the user how to re-apply it.
async function renderRestoreNotice(
  projectId: string,
  failures: RestoreFailure[],
): Promise<void> {
  const list = await send<{ ok: true; projects: { id: string; name: string }[] }>({
    type: 'listProjects',
  });
  const proj = list.projects.find((p) => p.id === projectId);
  const name = proj?.name ?? 'Project';

  const banner = el('div', { class: 'banner restore-notice' });
  banner.append(el('div', {}, [`Restored as "${name}".`]));
  banner.append(
    el('div', { class: 'subtle' }, [
      'Right-click a tab in the new window → Name window → ',
      el('strong', {}, [name]),
      ' so Chrome shows the project name in the OS title bar.',
    ]),
  );
  const close = el('button', {}, ['OK']);
  close.addEventListener('click', () => window.close());
  banner.append(close);
  root().append(banner);

  if (failures.length > 0) renderFailurePanel(failures);
}

function alertError(msg: string): void {
  const banner = el('div', { class: 'banner' }, [`Error: ${msg}`]);
  root().append(banner);
}

void render();
