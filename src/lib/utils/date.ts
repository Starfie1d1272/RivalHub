const CST_LOCALE = "zh-CN";
const CST_TZ = "Asia/Shanghai";
const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

export function formatCST(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(CST_LOCALE, {
    timeZone: CST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function parseCST(str: string): Date {
  return new Date(str);
}

/** datetime-local 输入不含时区信息，管理员在 CST 时区输入 → 解析为 UTC Date */
export function parseCSTInput(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value + "+08:00");
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 将 UTC Date 转为 CST datetime-local 输入框显示值 */
export function toCSTDateTimeInput(value: Date | null): string | null {
  if (!value) return null;
  const d = new Date(value.getTime() + CST_OFFSET_MS);
  return d.toISOString().slice(0, 16);
}

export function getCountdownSeconds(deadline: Date | string): number {
  const d = typeof deadline === "string" ? new Date(deadline) : deadline;
  return Math.max(0, Math.floor((d.getTime() - Date.now()) / 1000));
}

export function isDeadlinePassed(deadline: Date | string): boolean {
  const d = typeof deadline === "string" ? new Date(deadline) : deadline;
  return d.getTime() <= Date.now();
}

/** MVP 投票截止窗口：比赛结束后 24 小时 */
export const MVP_DEADLINE_MS = 24 * 60 * 60 * 1000;

export function formatCSTShortDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(CST_LOCALE, { timeZone: CST_TZ, month: "short", day: "numeric" });
}
