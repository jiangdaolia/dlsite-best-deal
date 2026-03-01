import type { PriceRecord } from '@/shared/types';
import { toCsvCell } from '@/shared/utils';

export function recordsToCsv(records: PriceRecord[]): string {
  const headers = [
    'RJ号',
    '标题',
    '当前价格',
    '历史最低价',
    '原价',
    '折扣率',
    '是否收藏',
    '最后检查时间',
    'DLwatcher链接',
  ];

  const rows = records.map((r) => [
    toCsvCell(r.rjCode),
    toCsvCell(r.title),
    toCsvCell(r.currentPrice),
    toCsvCell(r.lowestPrice),
    toCsvCell(r.regularPrice),
    toCsvCell(r.discountRate),
    toCsvCell(r.isFavorite ? '是' : '否'),
    toCsvCell(r.lastChecked),
    toCsvCell(r.dlwatcherUrl),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
