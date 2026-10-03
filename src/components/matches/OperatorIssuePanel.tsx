import type { ReviewReason } from "@/lib/admin/matches/source-state";
import { REVIEW_REASON_LABEL } from "@/lib/admin/matches/source-state";
import { mapLabel } from "@/lib/maps";
import { formatCSTDateTime } from "@/lib/utils/date";

const steps: Record<ReviewReason, string[]> = {
  identity_mismatch: ["在 Mizar 检查选中的赛事与比赛，必须与下方双方队伍一致；再确认游戏正在采集这场比赛。", "本站尚未保存具体是哪一项身份不符，不能据此判断是哪队有误。修正 Mizar 选择后等待重新核验，再更新比赛信息。"],
  lineup_mismatch: ["展开下方「首发、BP 与赛程管理」中的双方首发，与 Mizar 当前采集的十名玩家逐一比对。", "本次报告未提供具体差异名单。先排除采集错房间；如确有换人，按赛事规定确认后再通过首发管理登记，不能只为消除提示而改名单。"],
  execution_mismatch: ["比较本站当前地图与 Mizar 上报地图，检查是否采集了另一场比赛或上一图。不要把正式地图计划改成错误上报的地图。", "若自动记录无法恢复，确认下方指定地图后改为手动录分。后续正确上报不会自动消除已记录的地图冲突；恢复仍检查当前会话和地图顺序。"],
  result_conflict: ["对照 Perfect 最终比分核对本站正式比分与上报比分。已有正式比分会保留，自动上报不会覆盖。", "本站比分正确时修正 Mizar 对局。正式比分确有错误时，先记录差异并联系赛事管理员，暂勿继续录入后续比分。当前逐图更正仅对已结束的系列赛开放，位于「危险操作与结果恢复」，且不能改变系列赛胜者。"],
  source_conflict: ["在 Mizar 确认当前负责发送本场数据的设备，使用 Mizar 的数据源切换流程处理重复来源。", "切换设备与手动录分是两件事；下方按钮只改变本图比分的录入方式。"],
  continuity_failure: ["检查 Mizar 是否重启或切换了游戏来源，并核对当前比赛及地图。本站无法确认新来源与此前对局的连续关系。", "当前地图未绑定时，先按正式地图计划明确恢复地图，再手动录分；不需要撤销整台设备授权。"],
};

export function OperatorIssuePanel({ reasons, review }: { reasons: ReviewReason[]; review: {
  expectedTeams: string; currentMap: string | null; officialScore: string | null;
  evidence: { at: string; mapBinding: string; mapName: string | null; scoreA: number | null; scoreB: number | null } | null;
} }) {
  if (!reasons.length) return null;
  return <section aria-label="异常核对步骤" className="space-y-3 rounded border border-[var(--color-warn)] p-4 text-sm">
    <p><strong>本站记录：</strong>{review.expectedTeams} · {review.currentMap ?? "当前地图尚未绑定"}{review.officialScore && ` · 正式比分 ${review.officialScore}`}</p>
    {review.evidence && <p><strong>未采纳的上报：</strong>{review.evidence.mapName ? mapLabel(review.evidence.mapName) : "未提供地图"}{review.evidence.scoreA !== null && review.evidence.scoreB !== null && ` · ${review.evidence.scoreA}:${review.evidence.scoreB}`} · 地图绑定：{review.evidence.mapBinding} · {formatCSTDateTime(new Date(review.evidence.at))}</p>}
    {reasons.map(reason => <div key={reason}><h3 className="font-semibold">{REVIEW_REASON_LABEL[reason]}</h3><ol className="mt-2 list-decimal space-y-1 pl-5">{steps[reason].map(step => <li key={step}>{step}</li>)}</ol></div>)}
  </section>;
}
