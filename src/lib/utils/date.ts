const CST_LOCALE = "zh-CN";
const CST_TZ = "Asia/Shanghai";

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

export function getCountdownSeconds(deadline: Date | string): number {
  const d = typeof deadline === "string" ? new Date(deadline) : deadline;
  return Math.max(0, Math.floor((d.getTime() - Date.now()) / 1000));
}

export function isDeadlinePassed(deadline: Date | string): boolean {
  const d = typeof deadline === "string" ? new Date(deadline) : deadline;
  return d.getTime() <= Date.now();
}
