import dayjs from 'dayjs';
import { RJ_CODE_REGEX } from './constants';

export function extractRjCodeFromUrl(url: string): string | null {
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
