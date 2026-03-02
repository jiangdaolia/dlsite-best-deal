import dayjs from 'dayjs';
import { RJ_CODE_REGEX } from './constants';

export function extractRjCodeFromUrl(url: string): string | null {
  // 优先从 product_id/ 路径段提取基础编号
  // 简中翻译版作品 URL 形如 product_id/RJ01059221.html?select=RJ01059226
  // 其中 product_id 后为基础编号，?select= 为翻译版编号（DLwatcher 不收录）
  const pathMatch = url.match(/product_id\/([RB]J\d{6,})/i);
  if (pathMatch) return pathMatch[1].toUpperCase();

  // 兜底：提取 URL 中第一个 RJ/BJ 编号
  const matched = url.match(RJ_CODE_REGEX);
  return matched ? matched[1].toUpperCase() : null;
}

export function nowIso(): string {
  return dayjs().toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toYen(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return `${Math.round(value).toLocaleString('ja-JP')}円`;
}

export function safeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

export function toCsvCell(raw: string | number | undefined): string {
  if (raw === undefined) return '';
  const value = String(raw);
  // 防御 CSV 公式注入：以 = + - @ \t \r 开头的值加前缀单引号
  const formulaPrefix = /^[=+\-@\t\r]/.test(value) ? "'" : '';
  if (formulaPrefix || value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${formulaPrefix}${value.replaceAll('"', '""')}"`;
  }
  return value;
}
