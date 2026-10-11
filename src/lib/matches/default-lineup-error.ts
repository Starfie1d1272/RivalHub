import "server-only";

/** A failed batch can contain committed matches; check them before recovery. */
export class DefaultLineupMaterializationError extends Error {
  constructor(cause: unknown, public readonly requestId: string) {
    super("Default lineup materialization failed", { cause });
    this.name = "DefaultLineupMaterializationError";
  }
}

export const DEFAULT_LINEUP_RECOVERY_MESSAGE = "默认首发补齐发生系统故障。请先在比赛工作台核对已保存首发；超级管理员按排查编号检查服务，恢复后可在系统设置的定时任务健康中运行一次。名单资格未满足的队伍仍需按工作台提示处理。";
