import { checkStandardMajorCapabilities } from "@/lib/competition/definition";
import type { CompetitionTemplate } from "@/lib/competition/templates";
import type { SeasonCapabilities } from "@/types/season";
import {
  buildMajorOpeningPlan,
  type MajorOpeningPlan,
} from "./opening";

export type MajorPrestartCheckKey =
  | "rules"
  | "teams"
  | "entrants-locked"
  | "rosters"
  | "duplicate-players"
  | "confirmations"
  | "qualification"
  | "administration"
  | "seeds"
  | "seed-recommendation"
  | "seed-override"
  | "reconfirmations"
  | "opening-plan";

export type MajorPrestartCheckState = "ready" | "blocked" | "unavailable";

export interface MajorPrestartCheck {
  key: MajorPrestartCheckKey;
  label: string;
  state: MajorPrestartCheckState;
  blockers: readonly string[];
}

/** 已持久化的队伍和名单事实。playerId 必须是赛季内稳定的人员标识。 */
export interface MajorPrestartTeamFact {
  teamId: string;
  playerIds: readonly string[];
  /** Immutable approved assertions frozen with this tournament roster. */
  educationVerificationIds: readonly (string | null)[];
}

export interface MajorPrestartTeamConfirmationFact {
  teamId: string;
  confirmed: boolean;
}

/** 资格或管理事项由拥有它的上游流程提供；未接入时传 null，而不是空数组。 */
export interface MajorPrestartIssueFact {
  label: string;
  resolved: boolean;
}

export interface MajorPrestartTournamentSeedFact {
  teamId: string;
  tournamentSeed: number;
}

export interface MajorPrestartSeedRecommendationFact {
  status: "missing" | "ready" | "mismatch";
}

export interface MajorPrestartSeedOverrideFact {
  required: boolean;
  reason: string | null;
}

export interface MajorPrestartReadinessInput {
  competitionTemplate: CompetitionTemplate;
  capabilities: SeasonCapabilities;
  teams: readonly MajorPrestartTeamFact[] | null;
  entrantsLocked: boolean | null;
  confirmations: readonly MajorPrestartTeamConfirmationFact[] | null;
  qualificationIssues: readonly MajorPrestartIssueFact[] | null;
  administrativeIssues: readonly MajorPrestartIssueFact[] | null;
  tournamentSeeds: readonly MajorPrestartTournamentSeedFact[] | null;
  seedConfirmation: { confirmed: boolean } | null;
  seedRecommendation: MajorPrestartSeedRecommendationFact | null;
  seedOverride: MajorPrestartSeedOverrideFact | null;
}

export interface MajorPrestartReadiness {
  /** 唯一可供界面消费的开赛结论；界面不得自行重新计算。 */
  canStart: boolean;
  checks: readonly MajorPrestartCheck[];
  blockers: readonly string[];
  /** 只要标准结构、32 队身份、1–32 种子和首轮格式可用就构造；它是赛前预览，不授予开赛权限。 */
  openingPlan: MajorOpeningPlan | null;
}

function ready(key: MajorPrestartCheckKey, label: string): MajorPrestartCheck {
  return { key, label, state: "ready", blockers: [] };
}

function blocked(
  key: MajorPrestartCheckKey,
  label: string,
  blockers: readonly string[],
): MajorPrestartCheck {
  return { key, label, state: "blocked", blockers };
}

function unavailable(key: MajorPrestartCheckKey, label: string): MajorPrestartCheck {
  return {
    key,
    label,
    state: "unavailable",
    blockers: [`${label}尚未接入/不可确认。`],
  };
}

function invalidTeamIds(teams: readonly MajorPrestartTeamFact[]): string[] {
  const ids = new Set<string>();
  const blockers: string[] = [];
  for (const team of teams) {
    const teamId = team.teamId.trim();
    if (!teamId) {
      blockers.push("存在缺少队伍标识的报名队伍。");
    } else if (ids.has(teamId)) {
      blockers.push(`队伍 ${teamId} 重复出现。`);
    } else {
      ids.add(teamId);
    }
  }
  return blockers;
}

function checkRosters(
  teams: readonly MajorPrestartTeamFact[] | null,
  policy: Pick<SeasonCapabilities, "minTeamSize" | "maxTeamSize" | "starterCount">,
): MajorPrestartCheck {
  const policyBlockers: string[] = [];
  if (!Number.isInteger(policy.minTeamSize) || policy.minTeamSize < 1) {
    policyBlockers.push("最小名单人数必须是正整数。");
  }
  if (!Number.isInteger(policy.maxTeamSize) || policy.maxTeamSize < policy.minTeamSize) {
    policyBlockers.push("最大名单人数必须是整数且不少于最小名单人数。");
  }
  if (!Number.isInteger(policy.starterCount) || policy.starterCount < 1) {
    policyBlockers.push("首发人数必须是正整数。");
  } else if (policy.starterCount > policy.maxTeamSize) {
    policyBlockers.push("首发人数不能超过最大名单人数。");
  }

  if (teams === null) {
    return policyBlockers.length === 0
      ? unavailable("rosters", "队伍名单")
      : blocked("rosters", "队伍名单", policyBlockers);
  }

  const blockers = teams.flatMap((team) => {
    const teamBlockers: string[] = [];
    const teamLabel = team.teamId || "（未命名）";
    if (team.playerIds.length < policy.minTeamSize) {
      teamBlockers.push(`队伍 ${teamLabel} 名单不足 ${policy.minTeamSize} 人。`);
    }
    if (Number.isInteger(policy.maxTeamSize) && team.playerIds.length > policy.maxTeamSize) {
      teamBlockers.push(`队伍 ${teamLabel} 名单超过上限 ${policy.maxTeamSize} 人。`);
    }
    if (Number.isInteger(policy.starterCount) && policy.starterCount > 0 && team.playerIds.length < policy.starterCount) {
      teamBlockers.push(`队伍 ${teamLabel} 无法组成 ${policy.starterCount} 名首发。`);
    }
    if (team.educationVerificationIds.length !== team.playerIds.length || team.educationVerificationIds.some((id) => !id?.trim())) {
      teamBlockers.push(`队伍 ${teamLabel} 存在未冻结的教育认证依据。`);
    }
    return teamBlockers;
  });
  blockers.unshift(...policyBlockers);
  return blockers.length === 0
    ? ready("rosters", "队伍名单")
    : blocked("rosters", "队伍名单", blockers);
}

function checkDuplicatePlayers(teams: readonly MajorPrestartTeamFact[] | null): MajorPrestartCheck {
  if (teams === null) return unavailable("duplicate-players", "重复 player 检查");

  const playerTeams = new Map<string, string[]>();
  const blockers: string[] = [];
  for (const team of teams) {
    for (const rawPlayerId of team.playerIds) {
      const playerId = rawPlayerId.trim();
      if (!playerId) {
        blockers.push(`队伍 ${team.teamId || "（未命名）"} 存在缺少 player 标识的成员。`);
        continue;
      }
      const memberships = playerTeams.get(playerId) ?? [];
      memberships.push(team.teamId || "（未命名）");
      playerTeams.set(playerId, memberships);
    }
  }

  for (const [playerId, teamIds] of playerTeams) {
    if (teamIds.length > 1) {
      blockers.push(`player ${playerId} 同时出现在 ${teamIds.join("、")} 的名单中。`);
    }
  }
  return blockers.length === 0
    ? ready("duplicate-players", "重复 player 检查")
    : blocked("duplicate-players", "重复 player 检查", blockers);
}

function checkTeamConfirmations(
  key: "confirmations" | "reconfirmations",
  label: string,
  facts: readonly MajorPrestartTeamConfirmationFact[] | null,
  teams: readonly MajorPrestartTeamFact[] | null,
): MajorPrestartCheck {
  if (facts === null) return unavailable(key, label);
  if (teams === null) return unavailable(key, label);

  const teamIds = new Set(teams.map((team) => team.teamId));
  const seen = new Set<string>();
  const blockers: string[] = [];
  for (const fact of facts) {
    if (!teamIds.has(fact.teamId)) {
      blockers.push(`${label}包含不在本届赛事内的队伍 ${fact.teamId}。`);
    }
    if (seen.has(fact.teamId)) {
      blockers.push(`队伍 ${fact.teamId} 存在重复的${label}记录。`);
    }
    seen.add(fact.teamId);
    if (!fact.confirmed) blockers.push(`队伍 ${fact.teamId} 尚未${label}。`);
  }
  for (const teamId of teamIds) {
    if (!seen.has(teamId)) blockers.push(`队伍 ${teamId} 缺少${label}记录。`);
  }
  return blockers.length === 0 ? ready(key, label) : blocked(key, label, blockers);
}

function checkIssues(
  key: "qualification" | "administration",
  label: string,
  facts: readonly MajorPrestartIssueFact[] | null,
): MajorPrestartCheck {
  if (facts === null) return unavailable(key, label);
  const blockers = facts
    .filter((fact) => !fact.resolved)
    .map((fact) => `${label}未完成：${fact.label || "未命名事项"}。`);
  return blockers.length === 0 ? ready(key, label) : blocked(key, label, blockers);
}

function checkEntrantsLocked(entrantsLocked: boolean | null): MajorPrestartCheck {
  if (entrantsLocked === null) return unavailable("entrants-locked", "正式参赛队锁定");
  return entrantsLocked
    ? ready("entrants-locked", "正式参赛队锁定")
    : blocked("entrants-locked", "正式参赛队锁定", ["请先锁定正式参赛队和最终赛事名单。"]);
}

function checkSeedConfirmation(
  fact: MajorPrestartReadinessInput["seedConfirmation"],
): MajorPrestartCheck {
  if (fact === null) return unavailable("reconfirmations", "种子重新确认");
  return fact.confirmed
    ? ready("reconfirmations", "种子重新确认")
    : blocked("reconfirmations", "种子重新确认", ["赛事种子已变化，必须重新确认后才能开赛。"]);
}

function checkSeedRecommendation(
  fact: MajorPrestartReadinessInput["seedRecommendation"],
): MajorPrestartCheck {
  if (fact === null) return unavailable("seed-recommendation", "系统种子建议快照");
  if (fact.status === "ready") return ready("seed-recommendation", "系统种子建议快照");
  return blocked(
    "seed-recommendation",
    "系统种子建议快照",
    [fact.status === "missing"
      ? "系统种子建议快照尚未生成，请先完成正式参赛队和 EventRoster 的统一冻结。"
      : "系统种子建议快照与当前冻结的参赛队或 EventRoster 不一致，请重新核对冻结事实。"],
  );
}

function checkSeedOverride(
  fact: MajorPrestartReadinessInput["seedOverride"],
): MajorPrestartCheck {
  if (fact === null) return unavailable("seed-override", "种子人工偏离说明");
  if (!fact.required || Boolean(fact.reason?.trim())) return ready("seed-override", "种子人工偏离说明");
  return blocked("seed-override", "种子人工偏离说明", ["最终种子偏离系统建议时，必须填写简短的人工调整原因。"]);
}

function checkSeeds(
  teams: readonly MajorPrestartTeamFact[] | null,
  facts: readonly MajorPrestartTournamentSeedFact[] | null,
  capacity: number,
): { check: MajorPrestartCheck; seeds: readonly MajorPrestartTournamentSeedFact[] | null } {
  if (facts === null || teams === null) {
    return { check: unavailable("seeds", `赛事 1–${capacity} 种子`), seeds: null };
  }

  const teamIds = new Set(teams.map((team) => team.teamId));
  const seenTeams = new Set<string>();
  const seenSeeds = new Set<number>();
  const blockers: string[] = [];
  for (const fact of facts) {
    if (!teamIds.has(fact.teamId)) blockers.push(`种子 ${fact.tournamentSeed} 指向不存在的队伍 ${fact.teamId}。`);
    if (seenTeams.has(fact.teamId)) blockers.push(`队伍 ${fact.teamId} 被分配了重复种子。`);
    seenTeams.add(fact.teamId);
    if (!Number.isInteger(fact.tournamentSeed) || fact.tournamentSeed < 1 || fact.tournamentSeed > capacity) {
      blockers.push(`队伍 ${fact.teamId} 的种子必须是 1–${capacity} 的整数。`);
    } else if (seenSeeds.has(fact.tournamentSeed)) {
      blockers.push(`赛事种子 ${fact.tournamentSeed} 重复。`);
    }
    seenSeeds.add(fact.tournamentSeed);
  }
  for (let seed = 1; seed <= capacity; seed += 1) {
    if (!seenSeeds.has(seed)) blockers.push(`赛事种子 ${seed} 尚未分配。`);
  }
  for (const teamId of teamIds) {
    if (!seenTeams.has(teamId)) blockers.push(`队伍 ${teamId} 尚未分配赛事种子。`);
  }
  return {
    check: blockers.length === 0 ? ready("seeds", `赛事 1–${capacity} 种子`) : blocked("seeds", `赛事 1–${capacity} 种子`, blockers),
    seeds: blockers.length === 0 ? facts : null,
  };
}

/**
 * 评估标准 32 队 Major 的赛前就绪状态。
 *
 * 这是纯领域函数：它不读写数据库、不改变赛季状态，也不创建比赛。未接入
 * 的持久化事实必须以 null 表示；函数将其保留为不可确认状态而不是当作无问题。
 */
export function evaluateMajorPrestartReadiness(
  input: MajorPrestartReadinessInput,
): MajorPrestartReadiness {
  const rules = input.competitionTemplate === "major"
    ? checkStandardMajorCapabilities(input.capabilities)
    : null;
  const ruleBlockers = rules
    ? rules.failures.map((failure) => failure.reason)
    : ["当前赛事模板不是 major，不能进入 Major runtime。"];
  const checks: MajorPrestartCheck[] = [
    rules?.isStandardMajor === true
      ? ready("rules", "标准 Major 规则")
      : blocked("rules", "标准 Major 规则", ruleBlockers),
  ];
  const entrantCapacity = rules?.entrantCapacity ?? 0;

  const teamBlockers = input.teams === null
    ? null
    : [
        ...invalidTeamIds(input.teams),
        ...(rules?.isStandardMajor === true && input.teams.length === entrantCapacity
          ? []
          : [`当前有 ${input.teams.length} 支队伍，Major 开赛需要恰好 ${entrantCapacity || "标准容量"} 支队伍。`]),
      ];
  checks.push(
    teamBlockers === null
      ? unavailable("teams", `${entrantCapacity || "标准容量"} 支参赛队伍`)
      : teamBlockers.length === 0
        ? ready("teams", `${entrantCapacity} 支参赛队伍`)
        : blocked("teams", `${entrantCapacity || "标准容量"} 支参赛队伍`, teamBlockers),
  );
  checks.push(checkEntrantsLocked(input.entrantsLocked));
  checks.push(checkRosters(input.teams, input.capabilities));
  checks.push(checkDuplicatePlayers(input.teams));
  checks.push(checkTeamConfirmations("confirmations", "参赛确认", input.confirmations, input.teams));
  checks.push(checkIssues("qualification", "资格事项", input.qualificationIssues));
  checks.push(checkIssues("administration", "管理事项", input.administrativeIssues));
  const seedResult = checkSeeds(input.teams, input.tournamentSeeds, entrantCapacity);
  checks.push(seedResult.check);
  checks.push(checkSeedRecommendation(input.seedRecommendation));
  checks.push(checkSeedOverride(input.seedOverride));
  checks.push(checkSeedConfirmation(input.seedConfirmation));

  let openingPlan: MajorOpeningPlan | null = null;
  const stageOneMatchFormat = input.capabilities.stagePlan[0]?.matchFormat;
  if (
    rules?.isStandardMajor !== true ||
    teamBlockers === null ||
    teamBlockers.length > 0 ||
    seedResult.seeds === null ||
    entrantCapacity <= 0 ||
    (stageOneMatchFormat !== "bo1" && stageOneMatchFormat !== "bo3")
  ) {
    checks.push(blocked("opening-plan", "开赛计划", [`开赛计划不可用：标准 Major 结构、${entrantCapacity || "标准容量"} 队身份、完整 1–${entrantCapacity || "标准容量"} 种子和阶段一赛制必须先可用于构造预览。`]));
  } else {
    try {
      openingPlan = buildMajorOpeningPlan({
        teams: seedResult.seeds,
        stageOneMatchFormat,
      });
      checks.push(ready("opening-plan", "开赛计划"));
    } catch {
      checks.push(blocked("opening-plan", "开赛计划", ["开赛计划无法构造，请核对赛事种子和阶段规则。"]));
    }
  }

  const blockers = checks.flatMap((check) => check.blockers);
  return {
    canStart: blockers.length === 0,
    checks,
    blockers,
    openingPlan,
  };
}
