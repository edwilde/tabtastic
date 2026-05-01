import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Tabtastic!',
  description:
    'Window Time Machine — save and restore your Chrome project windows: tab groups, colors, names, and all.',
  version: '0.1.0',
  // === T01 base permissions ===
  permissions: ['tabs', 'tabGroups', 'windows', 'storage'],
  // === /T01 ===
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  action: { default_popup: 'src/popup/index.html', default_title: 'Tabtastic!' },
  options_page: 'src/options/index.html',
});
