import "server-only";

import { redactText } from "@/lib/observability/redact";
import { formatCST } from "@/lib/utils/date";
import { VIDEO_CHANGE_LABELS, type AuditLogDetail } from "./presentation";
import { isAuditUserId } from "./people";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function lookup(labels: Readonly<Record<string, string>>, value: unknown, fallback: string): string {
  return typeof value === "string" && Object.hasOwn(labels, value) ? labels[value]! : fallback;
}

function state(value: unknown): string {
  const snapshot = record(value);
  if (typeof snapshot.hasVideoUrl !== "boolean") return "未记录";
  const video = snapshot.hasVideoUrl ? "已关联录像" : "未关联录像";
  if (typeof snapshot.rosterReopened === "boolean") return `${snapshot.rosterReopened ? "名单待更正" : "沿用已登记名单"} · ${video}`;
  return typeof snapshot.submitted === "boolean" ? `${snapshot.submitted ? "已提交" : "待整理"} · ${video}` : video;
}

/** Action-specific safe detail projection; raw metadata never crosses the action boundary. */
export function describeAuditDetail(action: string, meta: unknown, names: ReadonlyMap<string, string>): Pick<AuditLogDetail, "description" | "fields"> {
  const values = record(meta);
  const fields: AuditLogDetail["fields"] = [];
  let description: string | null = null;
  if (action === "postmatch.report.submit" || action === "postmatch.report.revoke" || action === "postmatch.video.update") {
    fields.push({ label: "操作前", value: state(values.before) }, { label: "操作后", value: state(values.after) });
  }
  if (action === "postmatch.report.submit" || action === "postmatch.report.revoke") {
    const submitter = isAuditUserId(values.submittedByUserId) ? names.get(values.submittedByUserId) ?? "未知用户" : "未记录";
    fields.push({ label: action === "postmatch.report.revoke" ? "原提交人" : "提交人", value: submitter });
    description = action === "postmatch.report.revoke"
      ? "开放实际解说名单更正。本场暂不计入有效解说场次；比分、Demo、统计和录像保留。"
      : "记录实际解说名单已确认；录像仍可单独更新。";
  }
  if (action === "postmatch.report.revoke") {
    const originalAt = typeof values.originalSubmittedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(values.originalSubmittedAt)
      ? new Date(values.originalSubmittedAt) : null;
    fields.push({ label: "原提交时间", value: originalAt && Number.isFinite(originalAt.getTime()) ? formatCST(originalAt) : "未记录" });
    // Only this explicitly collected operator reason is eligible for detail display.
    // URLs and credentials are not useful here and must not become a secret side channel.
    const reason = typeof values.reason === "string"
      ? redactText(values.reason.replace(/https?:\/\/\S+/gi, "[链接已隐藏]"), 500).trim() : "";
    fields.push({ label: "撤销原因", value: reason || "未记录" });
  }
  if (action === "postmatch.video.update") {
    fields.push({ label: "录像变更", value: lookup(VIDEO_CHANGE_LABELS, values.videoChange, "未记录") });
    description = "录像登记可单独更新。历史未保存的链接内容和前后状态无法从当前资料还原。";
  }
  if (action === "mizar.reliable.accept") {
    const kinds: Readonly<Record<string, string>> = { match_started: "比赛开始", map_started: "地图开始", map_ended: "地图结束", map_player_snapshot: "地图选手临时数据", series_ended: "系列赛结束", identity_mismatch: "比赛身份不一致", lineup_mismatch: "出场名单不一致", source_generation_changed: "采集来源代次变化", map_epoch_changed: "地图轮次变化" };
    const outcomes: Readonly<Record<string, string>> = { observed: "已接收观察", armed: "已核验并允许记录赛果", canonicalized: "已写入正式赛果", consistent: "与正式赛果一致", needs_attention: "需要人工核对" };
    fields.push({ label: "事件", value: lookup(kinds, values.kind, values.kind == null || values.kind === "" ? "未记录" : "未知事件") });
    fields.push({ label: "处理结果", value: lookup(outcomes, values.outcome, "未记录") });
  }
  return { description, fields };
}
