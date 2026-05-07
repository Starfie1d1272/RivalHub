// Server Action 统一返回类型
// 所有 Server Action 必须返回 ActionResult<T>，禁止返回原始值或抛异常给客户端
//
// 使用约定：
//   ✅ return { success: true, data: { id: 123 } }
//   ✅ return { success: false, error: { code: "POSITION_FULL", message: "..." } }
//   ❌ throw new Error("...")  ← 应转为 success: false
//   ❌ return null              ← 应明确成功/失败语义

import type { ErrorCode } from "@/lib/errors";

export interface ActionError {
  code: ErrorCode;
  message: string;
  /** 字段级错误，用于表单展示（key = 字段名） */
  fieldErrors?: Record<string, string>;
  /** 调试用元数据 */
  meta?: Record<string, unknown>;
}

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: ActionError };

// ── 工具函数 ────────────────────────────────────────────────────────────

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}

export function fail(error: ActionError): ActionResult<never> {
  return { success: false, error };
}
