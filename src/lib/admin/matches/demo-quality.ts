import "server-only";

import type { matchDemoImports } from "@/db/schema";
import { DAK_DIAGNOSTICS_EXTENSION } from "@/lib/demo-evidence/diagnostics";
import { readStoredEvidence } from "@/lib/demo-integration/review";
import { ensureRequestId } from "@/lib/observability/context";
import { captureException } from "@/lib/observability/server";

export interface AdminDemoQuality {
  importId: string;
  matchMapId: string;
  mapOrder: number;
  mapName: string;
  summary: string;
  notice: string | null;
  issues: { label: string; code: string; path: string | null; message: string }[];
  capability: string | null;
  capabilityReason: string | null;
  coverage: string | null;
}

/** Admin-only bounded projection. Import decision/blockers remain owned by review/validation. */
export function projectAdminDemoQuality(
  row: typeof matchDemoImports.$inferSelect,
  map: { mapOrder: number; mapName: string },
): AdminDemoQuality {
  const base = { importId: row.id, matchMapId: row.matchMapId, ...map };
  try {
    const evidence = readStoredEvidence(row);
    const { qa, capabilities } = evidence.quality;
    const diagnostics = evidence.extensions[DAK_DIAGNOSTICS_EXTENSION];
    const availability = { available: "可用", partial: "部分可用", missing: "不可用" } as const;
    const reason = {
      no_kill_events: "本场没有击杀事件；空事件不代表能力缺失。",
      flags_and_named_active_weapon: "已观察到扩展击杀标记和可识别的当前武器。",
      no_named_active_weapon: "已观察到扩展击杀标记，但未观察到可识别的当前武器。",
      no_rich_kill_flags: "未观察到完整的扩展击杀标记。",
    } as const;
    return {
      ...base,
      summary: `QA 检查${qa.ok ? "通过" : "未通过"}：${qa.errorCount} 条错误，${qa.warningCount} 条警告。`,
      notice: diagnostics
        ? diagnostics.qa.omittedIssueCount > 0 ? `详情已截断，另有 ${diagnostics.qa.omittedIssueCount} 条未传送；总数仍以摘要为准。` : null
        : "此证据未提供逐条警告和能力原因；无法从数量还原历史详情。",
      issues: diagnostics?.qa.issues.map((issue) => ({
        label: issue.severity === "error" ? "错误" : "警告",
        code: issue.code, path: issue.path,
        message: issue.message === "[redacted: raw diagnostic]"
          ? "原始说明含运行日志或堆栈，已抑制；问题代码与定位仍保留。"
          : issue.message === "[redacted]"
            ? "无可安全展示的原始说明；问题代码与定位仍保留。"
            : issue.message.includes("[redacted]") ? `${issue.message}（敏感片段已脱敏）` : issue.message,
      })) ?? [],
      capability: `高级击杀信息：${availability[capabilities.richKills]}`,
      capabilityReason: diagnostics ? reason[diagnostics.richKills.reason] : "能力原因未提供。",
      coverage: diagnostics ? `击杀事件 ${diagnostics.richKills.eventCount} 条；含完整扩展标记 ${diagnostics.richKills.flagsEventCount} 条；当前武器可识别 ${diagnostics.richKills.namedActiveWeaponEventCount} 条。` : null,
    };
  } catch (error) {
    // Runtime correlation belongs to the read failure, never to the hashed Evidence.
    const failureId = ensureRequestId();
    captureException("demo.quality.read_failure", error, {
      scope: "admin.demo", operation: "read-stored-quality", errorClass: "invariant", level: "error",
      errorCode: "DEMO_QUALITY_READ_FAILED", requestId: failureId,
      safeContext: { importId: row.id, stage: "read-stored-evidence" },
    });
    return { ...base, summary: "质量详情无法读取。", notice: `请联系管理员核对这份 Demo 数据。诊断编号：${failureId}`,
      issues: [], capability: null, capabilityReason: null, coverage: null };
  }
}
