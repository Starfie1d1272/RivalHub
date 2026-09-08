import type { MajorPrestartCheck, MajorPrestartCheckKey, MajorPrestartReadiness } from "./prestart";

export interface MajorPrestartOperatorTask {
  label: string;
  detail: string;
  state: "blocked" | "pending";
}

export interface MajorPrestartSystemBlocker {
  label: string;
  detail: string;
  state: "blocked" | "pending";
}

const OPERATOR_TASKS: Partial<Record<MajorPrestartCheckKey, string>> = {
  "entrants-locked": "确定正式参赛队",
  confirmations: "确认正式参赛名单",
  qualification: "处理资格事项",
  administration: "处理运营事项",
  seeds: "保存最终种子",
  reconfirmations: "确认最终种子",
};

function presentBlockedCheck(check: MajorPrestartCheck): { detail: string; state: "blocked" | "pending" } {
  return {
    detail: check.blockers.join(" ") || (check.state === "unavailable" ? "当前资料尚不能确认。" : "等待处理。"),
    state: check.state === "blocked" ? "blocked" : "pending",
  };
}

/** 只将 canonical readiness 投影为运营台任务和异常，不重算开赛条件。 */
export function presentMajorPrestartReadiness(readiness: MajorPrestartReadiness): {
  tasks: MajorPrestartOperatorTask[];
  systemBlockers: MajorPrestartSystemBlocker[];
} {
  const tasks: MajorPrestartOperatorTask[] = [];
  const systemBlockers: MajorPrestartSystemBlocker[] = [];

  for (const check of readiness.checks) {
    if (check.state === "ready") continue;
    const presented = presentBlockedCheck(check);
    const taskLabel = OPERATOR_TASKS[check.key];
    if (taskLabel) tasks.push({ label: taskLabel, ...presented });
    else systemBlockers.push({ label: check.label, ...presented });
  }

  return { tasks, systemBlockers };
}
