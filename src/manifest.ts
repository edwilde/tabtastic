import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Tabtastic!',
  description:
    'Window Time Machine — save and restore your Chrome project windows: tab groups, colors, names, and all.',
  version: '0.6.0',
  // === T01 base permissions ===
  // === T10 adds: alarms ===
  permissions: ['tabs', 'tabGroups', 'windows', 'storage', 'alarms'],
  // === /T10 ===
  // === /T01 ===
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  // === T07 — icons (T27: default toolbar icon is grey for unbound windows;
  // chrome.action.setIcon swaps to teal at runtime once a project is bound)
  icons: {
    16: 'src/assets/icon-16.png',
    32: 'src/assets/icon-32.png',
    48: 'src/assets/icon-48.png',
    128: 'src/assets/icon-128.png',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Tabtastic!',
    default_icon: {
      16: 'src/assets/icon-grey-16.png',
      32: 'src/assets/icon-grey-32.png',
    },
  },
  // === /T07 ===
  options_page: 'src/options/index.html',
});
