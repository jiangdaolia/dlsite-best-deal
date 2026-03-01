import type { PriceRecord } from '@/shared/types';
import { sendRuntimeMessage } from '@/shared/runtime';
import { toYen } from '@/shared/utils';

const statusEl = document.getElementById('status') as HTMLParagraphElement;
const tableBody = document.getElementById('table-body') as HTMLTableSectionElement;

function setStatus(message: string): void {
  statusEl.textContent = message;
}

function dlsiteSection(code: string): string {
  return code.toUpperCase().startsWith('BJ') ? 'girls-drama' : 'girls';
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function buildRow(record: PriceRecord): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const section = dlsiteSection(record.rjCode);
  const dlsiteUrl = `https://www.dlsite.com/${section}/work/=/product_id/${record.rjCode}.html`;
  const displayTitle = record.title && record.title !== record.rjCode ? escapeHtml(record.title) : '';

  tr.innerHTML = `
    <td class="cell-code"><a href="${dlsiteUrl}" target="_blank" rel="noreferrer">${record.rjCode}</a></td>
    <td class="cell-title" title="${escapeHtml(record.title || '')}">${displayTitle}</td>
    <td>${toYen(record.lowestPrice)}</td>
    <td class="${record.isFavorite ? 'tag-yes' : 'tag-no'}">${record.isFavorite ? '★' : '-'}</td>
    <td>${record.lastChecked || '-'}</td>
    <td><button data-rj="${record.rjCode}">更新</button></td>
  `;

  const btn = tr.querySelector('button');
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    setStatus(`更新 ${record.rjCode} 中...`);
    const response = await sendRuntimeMessage({
      type: 'UPDATE_ONE',
      payload: { rjCode: record.rjCode },
    });

    if (!response.ok) {
      setStatus(`更新失败：${response.error ?? '未知错误'}`);
    } else {
      setStatus(`更新完成：${record.rjCode}`);
      await loadTable();
    }
    btn.disabled = false;
  });

  return tr;
}

async function loadTable(): Promise<void> {
  const response = await sendRuntimeMessage<PriceRecord[]>({
    type: 'LIST_RECORDS',
  });

  if (!response.ok || !response.data) {
    setStatus(response.error ?? '列表加载失败');
    return;
  }

  const records = [...response.data].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) {
      return a.isFavorite ? -1 : 1;
    }
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });

  tableBody.innerHTML = '';
  for (const record of records) {
    tableBody.appendChild(buildRow(record));
  }

  setStatus(`共 ${records.length} 条记录`);
}

document.getElementById('refresh')?.addEventListener('click', () => {
  void loadTable();
});

document.getElementById('update-all')?.addEventListener('click', async () => {
  setStatus('正在更新全部收藏...');
  const response = await sendRuntimeMessage<{ imported: number }>({
    type: 'UPDATE_ALL_FAVORITES',
  });

  if (!response.ok) {
    setStatus(`批量更新失败：${response.error ?? '未知错误'}`);
    return;
  }

  setStatus(`批量更新完成：${response.data?.imported ?? 0} 条`);
  await loadTable();
});

document.getElementById('export')?.addEventListener('click', async () => {
  const response = await sendRuntimeMessage<{ csv: string }>({
    type: 'EXPORT_CSV',
  });

  if (!response.ok || !response.data) {
    setStatus(`导出失败：${response.error ?? '未知错误'}`);
    return;
  }

  const blob = new Blob([response.data.csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dltracker-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus('CSV 导出完成');
});

void loadTable();
