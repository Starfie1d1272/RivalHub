// 应用错误分类——所有 Server Action 抛出的错误必须使用这里定义的代码
//
// 使用方式：
//   import { AppError, ErrorCode } from "@/lib/errors";
//   throw new AppError(ErrorCode.POSITION_FULL, "AWP 位置已满员");
//
// 在 Server Action 中：
//   try {
//     ...
//   } catch (e) {
//     if (e instanceof AppError) {
//       return { success: false, error: { code: e.code, message: e.message } };
//     }
//     throw e; // unexpected error，由 Next.js error boundary 处理
//   }

export const ErrorCode = {
  // ── 通用 ─────────────────────────────────────────
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",

  // ── Season ──────────────────────────────────────
  SEASON_NOT_FOUND: "SEASON_NOT_FOUND",
  SEASON_INVALID_STATUS: "SEASON_INVALID_STATUS",
  SEASON_CAPABILITY_DISABLED: "SEASON_CAPABILITY_DISABLED",

  // ── Registration ────────────────────────────────
  REGISTRATION_CLOSED: "REGISTRATION_CLOSED",
  REGISTRATION_DUPLICATE: "REGISTRATION_DUPLICATE",
  POSITION_FULL: "POSITION_FULL",
  SCREENSHOT_REQUIRED: "SCREENSHOT_REQUIRED",
  REGISTRATION_FULL: "REGISTRATION_FULL",
  REGISTRATION_INVALID_TRANSITION: "REGISTRATION_INVALID_TRANSITION",

  // ── Captain Voting ──────────────────────────────
  VOTING_CLOSED: "VOTING_CLOSED",
  VOTE_LIMIT_REACHED: "VOTE_LIMIT_REACHED", // 已投 3 票
  VOTE_SELF: "VOTE_SELF",
  VOTE_DUPLICATE: "VOTE_DUPLICATE",
  CAPTAIN_NOT_ELIGIBLE: "CAPTAIN_NOT_ELIGIBLE",

  // ── Draft ───────────────────────────────────────
  DRAFT_NOT_ACTIVE: "DRAFT_NOT_ACTIVE",
  DRAFT_NOT_YOUR_TURN: "DRAFT_NOT_YOUR_TURN",
  DRAFT_DEADLINE_PASSED: "DRAFT_DEADLINE_PASSED",
  PLAYER_ALREADY_PICKED: "PLAYER_ALREADY_PICKED",
  TEAM_POSITION_CAP_EXCEEDED: "TEAM_POSITION_CAP_EXCEEDED",

  // ── Match ───────────────────────────────────────
  MATCH_NOT_FOUND: "MATCH_NOT_FOUND",
  MATCH_INVALID_TRANSITION: "MATCH_INVALID_TRANSITION",
  MATCH_INVALID_SCORE: "MATCH_INVALID_SCORE",
  MATCH_MAP_INVALID: "MATCH_MAP_INVALID",
  MATCH_MAP_DUPLICATE: "MATCH_MAP_DUPLICATE",          // 同一 mapName 出现两次
  MATCH_MAP_ORDER_CONFLICT: "MATCH_MAP_ORDER_CONFLICT",// mapOrder 已存在
  MATCH_FORMAT_MISMATCH: "MATCH_FORMAT_MISMATCH",      // BO1 录入 2 张图等
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly meta?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }
}

// 错误代码 → 默认中文提示（可被覆盖）
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHORIZED: "请先登录",
  FORBIDDEN: "权限不足",
  VALIDATION_FAILED: "输入校验失败",
  NOT_FOUND: "目标不存在",
  INTERNAL_ERROR: "服务器内部错误，请稍后重试",

  SEASON_NOT_FOUND: "赛季不存在",
  SEASON_INVALID_STATUS: "赛季当前状态不允许此操作",
  SEASON_CAPABILITY_DISABLED: "该赛事未启用此功能",

  REGISTRATION_CLOSED: "报名通道未开放",
  REGISTRATION_DUPLICATE: "您已提交过报名",
  POSITION_FULL: "该位置主选名额已满",
  REGISTRATION_FULL: "报名总人数已达上限",
  SCREENSHOT_REQUIRED: "请上传天梯截图",
  REGISTRATION_INVALID_TRANSITION: "不允许的状态变更",

  VOTING_CLOSED: "投票通道未开放",
  VOTE_LIMIT_REACHED: "每人最多投 3 票",
  VOTE_SELF: "不能给自己投票",
  VOTE_DUPLICATE: "您已为该候选人投票",
  CAPTAIN_NOT_ELIGIBLE: "该候选人不符合队长资格",

  DRAFT_NOT_ACTIVE: "选秀未进行中",
  DRAFT_NOT_YOUR_TURN: "当前轮次不是您的队伍",
  DRAFT_DEADLINE_PASSED: "本轮选择时间已过",
  PLAYER_ALREADY_PICKED: "该选手已被选走",
  TEAM_POSITION_CAP_EXCEEDED: "该位置在本队已达 2 人上限",

  MATCH_NOT_FOUND: "比赛不存在",
  MATCH_INVALID_TRANSITION: "比赛状态变更不合法",
  MATCH_INVALID_SCORE: "比分不合法",
  MATCH_MAP_INVALID: "地图不在当前赛季 mappool 中",
  MATCH_MAP_DUPLICATE: "同一张图不能在系列赛中出现两次",
  MATCH_MAP_ORDER_CONFLICT: "该图序号已被使用",
  MATCH_FORMAT_MISMATCH: "提交的图数与比赛 BO 格式不一致",
};
