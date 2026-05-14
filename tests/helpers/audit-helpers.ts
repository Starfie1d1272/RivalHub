import { expect } from "vitest";

export interface AuditEntryLike {
  action?: string;
  actorId?: string;
  targetId?: string;
  targetType?: string;
  seasonId?: string | null;
  meta?: Record<string, unknown> | null;
}

/** 从 insert values 调用记录中查找指定 action 的审计日志条目 */
export function findAuditEntry(
  calls: unknown[],
  action: string,
): AuditEntryLike | undefined {
  return calls.find(
    (v): v is AuditEntryLike =>
      typeof v === "object" && v !== null && (v as AuditEntryLike).action === action,
  );
}

/** 断言 insert values 调用中包含指定的审计日志条目，并验证关键字段 */
export function expectAuditLog(
  calls: unknown[],
  action: string,
  expected?: Partial<AuditEntryLike>,
): void {
  const entry = findAuditEntry(calls, action);
  expect(entry, `Expected audit log entry with action "${action}"`).toBeDefined();
  if (expected) {
    for (const [key, value] of Object.entries(expected)) {
      expect(
        (entry as Record<string, unknown>)[key],
        `audit.${key} for "${action}"`,
      ).toBe(value);
    }
  }
}

/** 重置审计日志追踪数组（在 beforeEach 中调用） */
export function resetAuditTracking(...arrays: unknown[][]): void {
  for (const arr of arrays) {
    arr.length = 0;
  }
}
