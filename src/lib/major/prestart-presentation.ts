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
  teams: "确定正式参赛队",
  "entrants-locked": "确定正式参赛队",
  rosters: "完善正式名单",
  "duplicate-players": "处理重复选手",
  confirmations: "确认正式参赛名单",
  seeds: "保存最终种子",
  reconfirmations: "确认最终种子",
};

const PRESTART_PREREQUISITES = new Set<MajorPrestartCheckKey>([
  "rules",
  "teams",
  "entrants-locked",
  "rosters",
  "duplicate-players",
  "confirmations",
]);

const DERIVED_CHECK_DEPENDENCIES: Partial<Record<MajorPrestartCheckKey, readonly MajorPrestartCheckKey[]>> = {
  seeds: [...PRESTART_PREREQUISITES],
  "seed-recommendation": [...PRESTART_PREREQUISITES],
  reconfirmations: [...PRESTART_PREREQUISITES, "seeds", "seed-recommendation"],
  "opening-plan": [...PRESTART_PREREQUISITES, "seeds", "seed-recommendation", "reconfirmations"],
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
  const checksByKey = new Map(readiness.checks.map((check) => [check.key, check]));

  for (const check of readiness.checks) {
    if (check.state === "ready") continue;
    const dependencies = DERIVED_CHECK_DEPENDENCIES[check.key];
    if (dependencies?.some((dependency) => checksByKey.get(dependency)?.state !== "ready")) continue;
    if (check.key === "entrants-locked" && checksByKey.has("teams") && checksByKey.get("teams")?.state !== "ready") continue;
    const presented = presentBlockedCheck(check);
    const taskLabel = OPERATOR_TASKS[check.key];
    if (taskLabel) tasks.push({ label: taskLabel, ...presented });
    else systemBlockers.push({ label: check.label, ...presented });
  }

  return { tasks, systemBlockers };
}
