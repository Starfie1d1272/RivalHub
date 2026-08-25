import {
  checkStandardMajorCapabilities,
  type SeasonCapabilities,
} from "@/types/season";
import {
  buildMajorOpeningPlan,
  type MajorOpeningPlan,
} from "./opening";

const MAJOR_TEAM_COUNT = 32;

export type MajorPrestartCheckKey =
  | "rules"
  | "teams"
  | "rosters"
  | "duplicate-players"
  | "confirmations"
  | "qualification"
  | "administration"
  | "seeds"
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

export interface MajorPrestartReadinessInput {
  capabilities: SeasonCapabilities;
  teams: readonly MajorPrestartTeamFact[] | null;
  confirmations: readonly MajorPrestartTeamConfirmationFact[] | null;
  qualificationIssues: readonly MajorPrestartIssueFact[] | null;
  administrativeIssues: readonly MajorPrestartIssueFact[] | null;
  tournamentSeeds: readonly MajorPrestartTournamentSeedFact[] | null;
  reconfirmations: readonly MajorPrestartTeamConfirmationFact[] | null;
}

export interface MajorPrestartReadiness {
  /** 唯一可供界面消费的开赛结论；界面不得自行重新计算。 */
  canStart: boolean;
  checks: readonly MajorPrestartCheck[];
  blockers: readonly string[];
  /** 仅当所有开赛前条件满足时构造；否则为 null。 */
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
  minTeamSize: number,
): MajorPrestartCheck {
  if (teams === null) return unavailable("rosters", "队伍名单");

  const blockers = teams.flatMap((team) => {
    if (team.playerIds.length < minTeamSize) {
      return [`队伍 ${team.teamId || "（未命名）"} 名单不足 ${minTeamSize} 人。`];
    }
    return [];
  });
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

function checkSeeds(
  teams: readonly MajorPrestartTeamFact[] | null,
  facts: readonly MajorPrestartTournamentSeedFact[] | null,
): { check: MajorPrestartCheck; seeds: readonly MajorPrestartTournamentSeedFact[] | null } {
  if (facts === null || teams === null) {
    return { check: unavailable("seeds", "赛事 1–32 种子"), seeds: null };
  }

  const teamIds = new Set(teams.map((team) => team.teamId));
  const seenTeams = new Set<string>();
  const seenSeeds = new Set<number>();
  const blockers: string[] = [];
  for (const fact of facts) {
    if (!teamIds.has(fact.teamId)) blockers.push(`种子 ${fact.tournamentSeed} 指向不存在的队伍 ${fact.teamId}。`);
    if (seenTeams.has(fact.teamId)) blockers.push(`队伍 ${fact.teamId} 被分配了重复种子。`);
    seenTeams.add(fact.teamId);
    if (!Number.isInteger(fact.tournamentSeed) || fact.tournamentSeed < 1 || fact.tournamentSeed > MAJOR_TEAM_COUNT) {
      blockers.push(`队伍 ${fact.teamId} 的种子必须是 1–32 的整数。`);
    } else if (seenSeeds.has(fact.tournamentSeed)) {
      blockers.push(`赛事种子 ${fact.tournamentSeed} 重复。`);
    }
    seenSeeds.add(fact.tournamentSeed);
  }
  for (let seed = 1; seed <= MAJOR_TEAM_COUNT; seed += 1) {
    if (!seenSeeds.has(seed)) blockers.push(`赛事种子 ${seed} 尚未分配。`);
  }
  for (const teamId of teamIds) {
    if (!seenTeams.has(teamId)) blockers.push(`队伍 ${teamId} 尚未分配赛事种子。`);
  }
  return {
    check: blockers.length === 0 ? ready("seeds", "赛事 1–32 种子") : blocked("seeds", "赛事 1–32 种子", blockers),
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
  const rules = checkStandardMajorCapabilities(input.capabilities);
  const checks: MajorPrestartCheck[] = [
    rules.isStandardMajor
      ? ready("rules", "标准 Major 规则")
      : blocked("rules", "标准 Major 规则", rules.failures.map((failure) => failure.reason)),
  ];

  const teamBlockers = input.teams === null
    ? null
    : [
        ...invalidTeamIds(input.teams),
        ...(input.teams.length === MAJOR_TEAM_COUNT
          ? []
          : [`当前有 ${input.teams.length} 支队伍，Major 开赛需要恰好 32 支队伍。`]),
      ];
  checks.push(
    teamBlockers === null
      ? unavailable("teams", "32 支参赛队伍")
      : teamBlockers.length === 0
        ? ready("teams", "32 支参赛队伍")
        : blocked("teams", "32 支参赛队伍", teamBlockers),
  );
  checks.push(checkRosters(input.teams, input.capabilities.minTeamSize));
  checks.push(checkDuplicatePlayers(input.teams));
  checks.push(checkTeamConfirmations("confirmations", "参赛确认", input.confirmations, input.teams));
  checks.push(checkIssues("qualification", "资格事项", input.qualificationIssues));
  checks.push(checkIssues("administration", "管理事项", input.administrativeIssues));
  const seedResult = checkSeeds(input.teams, input.tournamentSeeds);
  checks.push(seedResult.check);
  checks.push(checkTeamConfirmations("reconfirmations", "赛前重新确认", input.reconfirmations, input.teams));

  const blockersBeforePlan = checks.flatMap((check) => check.blockers);
  let openingPlan: MajorOpeningPlan | null = null;
  if (blockersBeforePlan.length > 0 || seedResult.seeds === null) {
    checks.push(blocked("opening-plan", "开赛计划", ["开赛计划依赖所有赛前检查通过。"]));
  } else {
    try {
      const stageOneMatchFormat = input.capabilities.stagePlan[0]?.matchFormat;
      if (stageOneMatchFormat !== "bo1" && stageOneMatchFormat !== "bo3") {
        checks.push(blocked("opening-plan", "开赛计划", ["阶段一比赛赛制必须是 BO1 或 BO3。"]));
      } else {
        openingPlan = buildMajorOpeningPlan({
          teams: seedResult.seeds,
          stageOneMatchFormat,
        });
        checks.push(ready("opening-plan", "开赛计划"));
      }
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
