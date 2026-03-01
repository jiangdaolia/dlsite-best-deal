import { sendRuntimeMessage } from '@/shared/runtime';

const totalEl = document.getElementById('total') as HTMLSpanElement;
const favoritesEl = document.getElementById('favorites') as HTMLSpanElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;

async function loadStats(): Promise<void> {
  const response = await sendRuntimeMessage<{ total: number; favorites: number; discounted: number }>({
    type: 'GET_STATS',
  });

  if (!response.ok || !response.data) {
    statusEl.textContent = response.error ?? '统计加载失败';
    return;
  }

  totalEl.textContent = String(response.data.total);
  favoritesEl.textContent = String(response.data.favorites);
}

document.getElementById('open-options')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('update-favorites')?.addEventListener('click', async () => {
  statusEl.textContent = '正在更新收藏价格...';
  const response = await sendRuntimeMessage<{ imported: number }>({
    type: 'UPDATE_ALL_FAVORITES',
  });

  if (!response.ok) {
    statusEl.textContent = response.error ?? '更新失败';
    return;
  }

  statusEl.textContent = `更新完成：${response.data?.imported ?? 0} 条`;
  await loadStats();
});

void loadStats();
