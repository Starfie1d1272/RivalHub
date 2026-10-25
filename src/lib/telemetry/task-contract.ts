import { OPERATIONS } from "./operations";

export const TASK_STEPS = ["start", "edit", "submit", "recognize", "review", "confirm", "ready", "result", "validation"] as const;
export const TASK_VALIDATION_REASONS = ["required", "password_policy", "password_mismatch", "form_invalid", "file_type", "file_size", "server_validation"] as const;
export type TaskValidationReason = typeof TASK_VALIDATION_REASONS[number];
export type TaskStep = typeof TASK_STEPS[number];
const steps = TASK_STEPS.map(key => ({ key, label: ({ start: "开始", edit: "填写与选择", submit: "提交", recognize: "截图识别", review: "核对与修改", confirm: "确认", ready: "内容可用", result: "结果已呈现", validation: "检查输入" } satisfies Record<TaskStep, string>)[key] }));
const definition = (label: string, windowMs = 30 * 60_000) => ({ label, steps, windowMs });
export const TASKS = {
  content: definition("查阅赛事内容"),
  login: definition("登录请求确认"),
  account: definition("账号与身份设置"),
  profile: definition("完善参赛资料"),
  education: definition("提交教育认证"),
  teams: definition("队伍与邀请"),
  registration: definition("个人报名", 24 * 3600_000),
  team_registration: definition("本届名单与团队报名", 24 * 3600_000),
  scheduling: definition("安排比赛时间"),
  roster: definition("提交比赛阵容"),
  veto: definition("完成一次 BP 操作"),
  score_entry: definition("录入赛后成绩"),
  postmatch: definition("完善赛后资料"),
  predictions: definition("提交赛事预测"),
  bet: definition("参与赛事竞猜"),
  awards: definition("社区奖项与投票"),
  recruitment: definition("招募与找队"),
  administration: definition("赛事管理"),
} as const;
export type TaskName = keyof typeof TASKS;
export const TASK_NAMES = Object.keys(TASKS) as TaskName[];
/** Receiver support must precede emitting the current definition from clients. */
export const TASK_DEFINITION_VERSION = 2 as const;
export const TASK_DURATION_CAP_MS = 3600_000;
export interface TaskMeasurement {
  name: TaskName;
  definitionVersion: 1 | 2;
  attemptId: string;
  step: TaskStep;
  phase: "exposure" | "start" | "step" | "complete" | "cancel";
  activeMs?: number;
  /** v2 only: the corresponding measured clock exceeded TASK_DURATION_CAP_MS. */
  elapsedCensored?: true;
  activeCensored?: true;
  validationReason?: TaskValidationReason;
}
const registered = new Set<string>(OPERATIONS);
const families: Record<string, TaskName> = {
  account: "account", auth: "account", "auth-confirmation": "account", identity: "account", "password-recovery": "account", "session-management": "account", "user-merge": "account",
  "competitive-profile": "profile", "education-verifications": "education", teams: "teams", register: "registration", "competition-entries": "team_registration",
  "player-stats": "score_entry", postmatch: "postmatch", "demo-integration": "postmatch", predictions: "predictions", "free-predictions": "predictions", bet: "bet",
  "community-awards": "awards", captains: "awards", recruitment: "recruitment",
};
export function taskForOperation(operation: string): TaskName | undefined {
  if (!registered.has(operation)) return undefined;
  if (operation === "auth.loginWithPassword") return "login";
  if (operation === "account.updateProfile") return "profile";
  if (operation === "player-stats.castMatchMvpVote") return "awards";
  if (operation.startsWith("matches.veto")) return "veto";
  if (operation.startsWith("matches.scheduling.") || operation === "matches.updateMatchScheduledAt") return "scheduling";
  if (operation.startsWith("matches.roster.")) return "roster";
  return families[operation.split(".")[0]] ?? "administration";
}
export function taskForRoute(route: string): TaskName | undefined {
  if (route.startsWith("/admin")) return "administration";
  if (route === "/login") return "login";
  if (route.startsWith("/settings/education")) return "education";
  if (route.startsWith("/settings/competitive") || route === "/settings") return "profile";
  if (route.startsWith("/settings/") || route.startsWith("/auth/") || route.includes("password")) return "account";
  if (route.endsWith("/register")) return "registration";
  if (route.endsWith("/veto")) return "veto";
  if (route.endsWith("/predictions")) return "predictions";
  if (route.endsWith("/bet")) return "bet";
  if (route.endsWith("/community-awards") || route.endsWith("/captains")) return "awards";
  if (route === "/teams/recruitment") return "recruitment";
  if (route.startsWith("/my/teams") || route.startsWith("/team-invites/")) return "teams";
  return route === "/unknown" ? undefined : "content";
}
