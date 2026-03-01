const manifest = {
  manifest_version: 3,
  name: 'DL Price Tracker',
  version: '0.1.0',
  description: '在 DLsite 页面显示历史最低价，并管理收藏作品价格数据。',
  permissions: ['storage', 'activeTab', 'scripting'],
  host_permissions: ['https://www.dlsite.com/*', 'https://dlwatcher.com/*'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  action: {
    default_title: 'DL Price Tracker',
    default_popup: 'src/popup/index.html',
  },
  options_page: 'src/options/index.html',
  content_scripts: [
    {
      matches: ['https://www.dlsite.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
} satisfies chrome.runtime.ManifestV3;

export default manifest;
