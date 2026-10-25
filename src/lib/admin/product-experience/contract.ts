import { z } from "zod";

export const WorkflowQuery = z.object({
  days: z.enum(["7", "28", "90"]).default("7"),
  eventId: z.union([z.literal(""), z.uuid()]).default(""),
}).strict();
export type WorkflowFilters = z.infer<typeof WorkflowQuery>;
export interface WorkflowMetric {
  key: string; label: string; source: string; note: string;
  started: number; resolved: number; waiting: number; approved: number; missingTiming: number;
  p50: number | null; p90: number | null; oldestWaitingMs: number | null;
  trend: { day: string; started: number; resolved: number; waiting: number; p50: number | null; p90: number | null }[];
}
export interface PostmatchSummary {
  finished: number; ready: number; pending: number; reopened: number; missingCompletionTime: number;
  note: string;
}
export interface WorkflowData { postmatch: PostmatchSummary; capturedAt: number; from: number; filters: WorkflowFilters; rows: WorkflowMetric[] }
export const WORKFLOW_LABELS = {
  registration: { label: "团队报名审核", source: "报名提交记录", note: "按窗口内每次正式提交统计当前处理状态；已处理包含通过、候补、补正与拒绝，通过数单列。" },
  education: { label: "教育认证审核", source: "教育认证记录", note: "重提会产生新记录；按窗口内现存提交记录的当前审核状态统计，不还原历史时点或反复审核过程。平台级流程，仅在全部赛事范围展示。" },
  scheduling: { label: "比赛时间协商", source: "时间提议记录", note: "提出时间至回应，包含自动采纳；过期提议算已处理，但缺少回应时间时不计耗时。" },
  veto: { label: "地图禁选房间", source: "BP 房间状态", note: "开始至完成，包含等待对方和暂停；每场仅当前房间周期，重置前的周期不在此统计。" },
} as const;
