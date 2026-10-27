import type { Analysis } from "@/lib/telemetry/analysis-model";
import type { SchedulerHealthView } from "@/lib/scheduler/admin";

export interface HealthItem {
  label: string;
  status: "正常" | "需要关注" | "未核验";
  source: string;
  coverage: string;
  reason: string;
  action: string;
}
type Telemetry = { status: "ready"; data: Pick<Analysis, "meta" | "operations"> } | { status: "unconfigured" | "unavailable" };

export function hasUnconfirmedDispatch(job: SchedulerHealthView): boolean {
  return Boolean(job.dispatchRequestedAt && (!job.endpointSucceededAt || job.endpointSucceededAt < job.dispatchRequestedAt));
}

/** Only bounded aggregate counts cross this presentation boundary. */
export function serviceHealth(telemetry: Telemetry, jobs: SchedulerHealthView[] | null, now: number): HealthItem[] {
  const groups = [
    ["认证", ["auth.loginWithPassword"]],
    ["报名", ["register.submitRegistration", "competition-entries.submitCompetitionEntry"]],
    ["赛果更正", ["matches.corrections.applyMatchResultCorrection"]],
  ] as const;
  const journeys: HealthItem[] = groups.map(([label, keys]) => {
    const data = telemetry.status === "ready" ? telemetry.data : null;
    const rows = data?.operations.filter(row => (keys as readonly string[]).includes(row.key)) ?? [];
    const counts = rows.reduce((a, r) => ({ start: a.start + r.start, success: a.success + r.success, rejected: a.rejected + r.rejected, unknown: a.unknown + r.unknown, pending: a.pending + r.pending }), { start: 0, success: 0, rejected: 0, unknown: 0, pending: 0 });
    const incomplete = !data || data.meta.partial || data.meta.validUntil <= now;
    return {
      label, status: "未核验", source: data ? `客户端遥测，${new Date(data.meta.from).toISOString()} 至 ${new Date(data.meta.capturedAt).toISOString()}（UTC）` : "客户端遥测：读取失败或未配置",
      coverage: data ? `开始 ${counts.start}；成功 ${counts.success}；拒绝 ${counts.rejected}；未知 ${counts.unknown}；待定 ${counts.pending}${incomplete ? "；窗口不完整或已过期" : ""}` : "无可用样本",
      reason: incomplete ? "来源不可用、窗口不完整或已过期，无法判定。" : counts.start === 0 ? "窗口内无样本，无法判定。" : "客户端结果覆盖有限，尚无可信生产阈值，不能判定整体健康。",
      action: "在产品使用与体验中按操作和版本查看；未知或待定先核对业务事实与日志，不要直接重放。",
    };
  });
  const missing = !jobs || jobs.length === 0 || jobs.some(job => !job.primaryTriggeredAt);
  const unhealthy = jobs?.filter(job => job.status !== "normal").length ?? 0;
  const pendingDispatch = jobs?.some(hasUnconfirmedDispatch) ?? false;
  const scheduler: HealthItem = {
    label: "定时任务", status: pendingDispatch ? "需要关注" : !missing && !unhealthy ? "正常" : "未核验",
    source: "scheduler 当前健康投影；各任务使用自身的新鲜度窗口",
    coverage: jobs ? `${jobs.filter(job => job.primaryTriggeredAt).length} / ${jobs.length} 个任务有主调度记录；${unhealthy} 个未通过现有健康判定` : "读取失败",
    reason: pendingDispatch ? "存在尚未确认成功的派发请求。" : missing ? "部分记录缺失或读取失败。" : unhealthy ? "存在过期记录或未完成的调度请求，当前健康未核验。" : "全部主调度记录通过现有健康判定。",
    action: "查看下方定时任务健康与运行日志，核对主调度、派发和业务状态。",
  };
  return [...journeys, scheduler,
    { label: "完整性", status: "未核验", source: "生产结构化日志与 Better Stack 告警", coverage: "本页未读取告警或事件", reason: "缺少当前权威结果，不能由无样本推断正常。", action: "在 Better Stack 检查 production security / invariant 告警，并核对审计事实。" },
    { label: "依赖与备份保障", status: "未核验", source: "公共资源真实 GET、备份验证与 provider 控制台", coverage: "本页未读取这些证据", reason: "缺少当前资源、备份与配额证据。", action: "核对公共资源 GET、最近可信 full backup 验证及 provider 用量与预算。" },
  ];
}
