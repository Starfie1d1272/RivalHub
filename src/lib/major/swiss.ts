// RivalHub 2.0 — Valve-style Major Swiss 纯领域核心（deterministic pure domain logic）。
//
// source of truth：
//   entrants（stage-local initial seeds）
//   + canonical completed match facts
//   + finalizedRound
// → official Swiss state（projection）。
//
// 本模块不依赖 DB / network / runtime / React；同一输入必须始终得到
// 语义等价的输出；函数不修改调用方传入的任何数组 / 对象 / Map。

export type MajorSwissRound = 1 | 2 | 3 | 4 | 5;

export type MajorSwissFinalizedRound = 0 | MajorSwissRound;

export type MajorSwissStatus = "active" | "advanced" | "eliminated";

export type MajorSwissMatchFormat = "bo1" | "bo3";

/**
 * 瑞士阶段配置的比赛局制。
 *
 * BO5 在 StageConfig 层是合法的可选值，但 Major Swiss 不支持它；
 * generateNextMajorSwissRound 会明确拒绝，绝不降级为 BO3。
 */
export type MajorSwissStageMatchFormat = MajorSwissMatchFormat | "bo5";

export interface MajorSwissRecord {
  wins: number;
  losses: number;
}

export interface MajorSwissEntrant {
  teamId: string;

  /**
   * 当前 Swiss Stage 开始时的 stage-local seed。
   * 必须严格为 1..16 且唯一。
   */
  initialStageSeed: number;
}

export interface MajorSwissMatchFact {
  /**
   * canonical matches.id 的领域层表示。
   */
  matchId: string;

  round: MajorSwissRound;

  entryAId: string;
  entryBId: string;

  /**
   * 必须等于 entryAId 或 entryBId。
   *
   * 该类型只表示：
   * 已完成且存在明确胜者的 canonical match result。
   *
   * scheduled / in_progress / cancelled
   * 不转换成 MajorSwissMatchFact。
   */
  winnerId: string;
}

export interface MajorSwissTeamState {
  teamId: string;

  initialStageSeed: number;
  currentStageSeed: number;

  wins: number;
  losses: number;

  difficultyScore: number;

  status: MajorSwissStatus;

  /**
   * 已 finalized 的历史对手，按 round 顺序。
   */
  opponents: readonly string[];
}

export interface MajorSwissProjection {
  finalizedRound: MajorSwissFinalizedRound;

  /**
   * 按 currentStageSeed ASC。
   */
  teams: readonly MajorSwissTeamState[];

  active: readonly MajorSwissTeamState[];
  advanced: readonly MajorSwissTeamState[];
  eliminated: readonly MajorSwissTeamState[];

  isComplete: boolean;
}

export type MajorSwissPairingRule = "initial" | "high-low" | "six-team-priority";

export interface MajorSwissPairing {
  round: MajorSwissRound;

  record: MajorSwissRecord;

  higherSeedTeamId: string;
  lowerSeedTeamId: string;

  higherSeed: number;
  lowerSeed: number;

  format: MajorSwissMatchFormat;

  pairingRule: MajorSwissPairingRule;

  /**
   * 仅 R4/R5 six-team-priority 有值：
   * 1..15
   */
  priority?: number;
}

export interface MajorSwissQualifier {
  teamId: string;

  /**
   * 当前 Stage 完成后的最终 stage seed。
   */
  finalStageSeed: number;
}

// ── 常量 ────────────────────────────────────────────────

export const MAJOR_SWISS_TEAM_COUNT = 16;
const MAJOR_SWISS_WIN_THRESHOLD = 3;
const MAJOR_SWISS_LOSS_THRESHOLD = 3;

const MAJOR_SWISS_MAX_ROUND = 5;
const MAJOR_SWISS_ADVANCE_COUNT = MAJOR_SWISS_TEAM_COUNT / 2;

export type MajorSwissSixTeamPair = readonly [number, number];

export interface MajorSwissSixTeamPattern {
  readonly priority: number;
  readonly pairs: readonly MajorSwissSixTeamPair[];
}

/**
 * Valve Major 6-team priority patterns（共 15 个）。
 * 每组 6 队按 currentStageSeed ASC 编号 1..6 后，
 * 按 priority 1 → 15 选择第一个完全无 rematch 的方案。
 */
export const MAJOR_SWISS_SIX_TEAM_PRIORITY_PATTERNS = [
  { priority: 1, pairs: [[1, 6], [2, 5], [3, 4]] },
  { priority: 2, pairs: [[1, 6], [2, 4], [3, 5]] },
  { priority: 3, pairs: [[1, 5], [2, 6], [3, 4]] },
  { priority: 4, pairs: [[1, 5], [2, 4], [3, 6]] },
  { priority: 5, pairs: [[1, 4], [2, 6], [3, 5]] },
  { priority: 6, pairs: [[1, 4], [2, 5], [3, 6]] },
  { priority: 7, pairs: [[1, 6], [2, 3], [4, 5]] },
  { priority: 8, pairs: [[1, 5], [2, 3], [4, 6]] },
  { priority: 9, pairs: [[1, 3], [2, 6], [4, 5]] },
  { priority: 10, pairs: [[1, 3], [2, 5], [4, 6]] },
  { priority: 11, pairs: [[1, 4], [2, 3], [5, 6]] },
  { priority: 12, pairs: [[1, 3], [2, 4], [5, 6]] },
  { priority: 13, pairs: [[1, 2], [3, 6], [4, 5]] },
  { priority: 14, pairs: [[1, 2], [3, 5], [4, 6]] },
  { priority: 15, pairs: [[1, 2], [3, 4], [5, 6]] },
] as const;

// ── 内部类型与常量 ──────────────────────────────────────

interface InternalTeamState {
  teamId: string;
  initialStageSeed: number;
  wins: number;
  losses: number;
  difficultyScore: number;
  opponents: string[];
  status: MajorSwissStatus;
}

const EXPECTED_MATCH_COUNT: Readonly<Record<MajorSwissRound, number>> = {
  1: 8,
  2: 8,
  3: 8,
  4: 6,
  5: 3,
};

const EXPECTED_ACTIVE_DISTRIBUTION: Readonly<
  Record<MajorSwissRound, Readonly<Record<string, number>>>
> = {
  1: { "0-0": 16 },
  2: { "1-0": 8, "0-1": 8 },
  3: { "2-0": 4, "1-1": 8, "0-2": 4 },
  4: { "2-1": 6, "1-2": 6 },
  5: { "2-2": 6 },
};

function isMajorSwissRound(round: number): round is MajorSwissRound {
  return round === 1 || round === 2 || round === 3 || round === 4 || round === 5;
}

function parseRecordKey(key: string): MajorSwissRecord {
  const [wins, losses] = key.split("-");
  return { wins: Number(wins), losses: Number(losses) };
}

function computeStatus(wins: number, losses: number): MajorSwissStatus {
  if (wins >= MAJOR_SWISS_WIN_THRESHOLD) return "advanced";
  if (losses >= MAJOR_SWISS_LOSS_THRESHOLD) return "eliminated";
  return "active";
}

// ── 验证 ────────────────────────────────────────────────

function validateEntrants(entrants: readonly MajorSwissEntrant[]): void {
  if (entrants.length !== MAJOR_SWISS_TEAM_COUNT) {
    throw new Error(
      `entrants must contain exactly ${MAJOR_SWISS_TEAM_COUNT} teams (got ${entrants.length})`,
    );
  }

  const teamIds = new Set<string>();
  const seeds = new Set<number>();
  for (const entrant of entrants) {
    if (typeof entrant.teamId !== "string" || entrant.teamId.length === 0) {
      throw new Error("entrant teamId must be a non-empty string");
    }
    if (teamIds.has(entrant.teamId)) {
      throw new Error(`duplicate entrant teamId: ${entrant.teamId}`);
    }
    teamIds.add(entrant.teamId);

    const seed = entrant.initialStageSeed;
    if (!Number.isInteger(seed) || seed < 1 || seed > MAJOR_SWISS_TEAM_COUNT) {
      throw new Error(
        `invalid initialStageSeed ${seed}: must be an integer in 1..${MAJOR_SWISS_TEAM_COUNT}`,
      );
    }
    if (seeds.has(seed)) {
      throw new Error(`duplicate initialStageSeed: ${seed}`);
    }
    seeds.add(seed);
  }

  // seed 集合必须精确等于 1..16，禁止 sort 后偷偷补 seed
  for (let seed = 1; seed <= MAJOR_SWISS_TEAM_COUNT; seed += 1) {
    if (!seeds.has(seed)) {
      throw new Error(
        `initialStageSeed set must be exactly 1..${MAJOR_SWISS_TEAM_COUNT}; missing ${seed}`,
      );
    }
  }
}

function validateOfficialMatches(
  matches: readonly MajorSwissMatchFact[],
  entrantTeamIds: ReadonlySet<string>,
  finalizedRound: MajorSwissFinalizedRound,
): MajorSwissMatchFact[] {
  const official = matches.filter((match) => match.round <= finalizedRound);

  const seenMatchIds = new Set<string>();
  for (const match of official) {
    if (typeof match.matchId !== "string" || match.matchId.length === 0) {
      throw new Error("match matchId must be a non-empty string");
    }
    if (seenMatchIds.has(match.matchId)) {
      throw new Error(`duplicate matchId: ${match.matchId}`);
    }
    seenMatchIds.add(match.matchId);

    if (!isMajorSwissRound(match.round)) {
      throw new Error(`invalid match round: ${match.round}`);
    }
    if (!entrantTeamIds.has(match.entryAId) || !entrantTeamIds.has(match.entryBId)) {
      throw new Error(`match ${match.matchId} references a team outside the stage entrants`);
    }
    if (match.entryAId === match.entryBId) {
      throw new Error(`match ${match.matchId} pairs a team with itself`);
    }
    if (match.winnerId !== match.entryAId && match.winnerId !== match.entryBId) {
      throw new Error(`match ${match.matchId} winnerId must be one of the participants`);
    }
  }

  return official;
}

// ── Projection ──────────────────────────────────────────

export function projectMajorSwissStage(input: {
  entrants: readonly MajorSwissEntrant[];
  matches: readonly MajorSwissMatchFact[];
  finalizedRound: MajorSwissFinalizedRound;
}): MajorSwissProjection {
  const { entrants, matches, finalizedRound } = input;

  validateEntrants(entrants);
  const entrantTeamIds = new Set(entrants.map((entrant) => entrant.teamId));
  const official = validateOfficialMatches(matches, entrantTeamIds, finalizedRound);

  // 初始状态：16 × 0-0（按 initialStageSeed ASC）
  const states = new Map<string, InternalTeamState>();
  const byInitialSeed = [...entrants].sort((a, b) => a.initialStageSeed - b.initialStageSeed);
  for (const entrant of byInitialSeed) {
    states.set(entrant.teamId, {
      teamId: entrant.teamId,
      initialStageSeed: entrant.initialStageSeed,
      wins: 0,
      losses: 0,
      difficultyScore: 0,
      opponents: [],
      status: "active",
    });
  }

  // 按 round 1 → finalizedRound 顺序处理
  for (let round = 1; round <= finalizedRound; round += 1) {
    const roundMatches = official
      .filter((match) => match.round === round)
      .sort((a, b) => (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0));

    // 每个已 finalized round 必须完整
    const expectedCount = EXPECTED_MATCH_COUNT[round as MajorSwissRound];
    if (roundMatches.length !== expectedCount) {
      throw new Error(
        `finalized round ${round} is incomplete: expected ${expectedCount} matches, got ${roundMatches.length}`,
      );
    }

    // 轮开始时 snapshot record（用于 same-W-L 校验）
    const recordBeforeRound = new Map<string, MajorSwissRecord>();
    for (const state of states.values()) {
      recordBeforeRound.set(state.teamId, { wins: state.wins, losses: state.losses });
    }

    // 参与者验证：active、每队恰好一次、same W-L record
    const participants = new Set<string>();
    for (const match of roundMatches) {
      const teamA = states.get(match.entryAId)!;
      const teamB = states.get(match.entryBId)!;
      if (teamA.status !== "active" || teamB.status !== "active") {
        throw new Error(`round ${round} match ${match.matchId} includes a non-active team`);
      }
      if (participants.has(match.entryAId) || participants.has(match.entryBId)) {
        throw new Error(`round ${round} includes a team more than once`);
      }
      participants.add(match.entryAId);
      participants.add(match.entryBId);

      const recordA = recordBeforeRound.get(match.entryAId)!;
      const recordB = recordBeforeRound.get(match.entryBId)!;
      if (recordA.wins !== recordB.wins || recordA.losses !== recordB.losses) {
        throw new Error(
          `round ${round} match ${match.matchId} is cross-record ` +
            `(${recordA.wins}-${recordA.losses} vs ${recordB.wins}-${recordB.losses})`,
        );
      }
    }

    // 每个当时 active team 恰好参加一次
    let activeCount = 0;
    for (const state of states.values()) {
      if (state.status === "active") activeCount += 1;
    }
    if (participants.size !== activeCount) {
      throw new Error(
        `finalized round ${round} is incomplete: ${participants.size} participants but ${activeCount} active teams`,
      );
    }

    // 应用结果
    for (const match of roundMatches) {
      const winner = states.get(match.winnerId)!;
      const loserId = match.winnerId === match.entryAId ? match.entryBId : match.entryAId;
      const loser = states.get(loserId)!;
      winner.wins += 1;
      loser.losses += 1;
      winner.opponents.push(loserId);
      loser.opponents.push(winner.teamId);
    }

    for (const state of states.values()) {
      state.status = computeStatus(state.wins, state.losses);
    }
  }

  // Difficulty Score：所有 16 队重新计算（含 advanced / eliminated，不冻结）
  for (const state of states.values()) {
    let difficulty = 0;
    for (const opponentId of state.opponents) {
      const opponent = states.get(opponentId)!;
      difficulty += opponent.wins - opponent.losses;
    }
    state.difficultyScore = difficulty;
  }

  // currentStageSeed：wins DESC, losses ASC, difficultyScore DESC, initialStageSeed ASC
  const ranked = [...states.values()].sort(
    (a, b) =>
      b.wins - a.wins ||
      a.losses - b.losses ||
      b.difficultyScore - a.difficultyScore ||
      a.initialStageSeed - b.initialStageSeed,
  );
  const teams = ranked.map((state, index) => ({
    teamId: state.teamId,
    initialStageSeed: state.initialStageSeed,
    currentStageSeed: index + 1,
    wins: state.wins,
    losses: state.losses,
    difficultyScore: state.difficultyScore,
    status: state.status,
    opponents: [...state.opponents],
  }));

  return {
    finalizedRound,
    teams,
    active: teams.filter((team) => team.status === "active"),
    advanced: teams.filter((team) => team.status === "advanced"),
    eliminated: teams.filter((team) => team.status === "eliminated"),
    isComplete: finalizedRound === MAJOR_SWISS_MAX_ROUND,
  };
}

// ── Pairing 低层函数 ────────────────────────────────────

export function selectMajorSixTeamPairingPattern(
  seededTeamIds: readonly string[],
  priorMatches: readonly Pick<MajorSwissMatchFact, "entryAId" | "entryBId">[],
): {
  priority: number;
  pairs: readonly {
    higherSeedTeamId: string;
    lowerSeedTeamId: string;
  }[];
} {
  if (seededTeamIds.length !== 6) {
    throw new Error(`six-team pairing requires exactly 6 teams (got ${seededTeamIds.length})`);
  }
  if (new Set(seededTeamIds).size !== 6) {
    throw new Error("six-team pairing requires unique team ids");
  }

  const priorEdges = new Set<string>();
  for (const match of priorMatches) {
    const key =
      match.entryAId < match.entryBId
        ? `${match.entryAId}\u0000${match.entryBId}`
        : `${match.entryBId}\u0000${match.entryAId}`;
    priorEdges.add(key);
  }

  for (const pattern of MAJOR_SWISS_SIX_TEAM_PRIORITY_PATTERNS) {
    const pairs = pattern.pairs.map(([higherPosition, lowerPosition]) => ({
      higherSeedTeamId: seededTeamIds[higherPosition - 1],
      lowerSeedTeamId: seededTeamIds[lowerPosition - 1],
    }));
    const hasRematch = pairs.some((pair) => {
      const key =
        pair.higherSeedTeamId < pair.lowerSeedTeamId
          ? `${pair.higherSeedTeamId}\u0000${pair.lowerSeedTeamId}`
          : `${pair.lowerSeedTeamId}\u0000${pair.higherSeedTeamId}`;
      return priorEdges.has(key);
    });
    if (!hasRematch) {
      return { priority: pattern.priority, pairs };
    }
  }

  throw new Error("all 15 six-team priority patterns contain a rematch; no legal pairing exists");
}

export function getMajorSwissRequiredFormat(
  stageMatchFormat: MajorSwissStageMatchFormat,
  record: MajorSwissRecord,
): MajorSwissMatchFormat {
  if (stageMatchFormat !== "bo1" && stageMatchFormat !== "bo3") {
    throw new Error("Major Swiss stages do not support bo5 matchFormat");
  }
  if (record.wins >= MAJOR_SWISS_WIN_THRESHOLD || record.losses >= MAJOR_SWISS_LOSS_THRESHOLD) {
    throw new Error(`terminal record ${record.wins}-${record.losses} must not be scheduled`);
  }
  return stageMatchFormat === "bo3" || record.wins === 2 || record.losses === 2 ? "bo3" : "bo1";
}

/**
 * 剩余队伍（按 currentStageSeed ASC）是否存在完整 zero-rematch perfect matching。
 *
 * 小规模 deterministic backtracking（group 最大 8 队）：
 * 每层取 highest seed，从 lowest 向 higher 尝试 non-rematch candidate。
 * 用于 feasibility-aware high-low：候选对手必须保证剩余队伍仍可完整配对。
 */
function hasCompleteNonRematchMatching(teams: readonly MajorSwissTeamState[]): boolean {
  if (teams.length === 0) return true;
  if (teams.length % 2 !== 0) return false;

  const higher = teams[0];
  for (let i = teams.length - 1; i >= 1; i -= 1) {
    if (teams[i].opponents.includes(higher.teamId)) continue;
    const rest = teams.filter((_, index) => index !== 0 && index !== i);
    if (hasCompleteNonRematchMatching(rest)) return true;
  }
  return false;
}

// ── 下一轮配对 ──────────────────────────────────────────

export function generateNextMajorSwissRound(input: {
  entrants: readonly MajorSwissEntrant[];
  matches: readonly MajorSwissMatchFact[];
  finalizedRound: MajorSwissFinalizedRound;
  /** 当前 Swiss 阶段配置的比赛局制；必须由调用方明确提供。 */
  stageMatchFormat: MajorSwissStageMatchFormat;
}): readonly MajorSwissPairing[] {
  const { stageMatchFormat } = input;
  // 在投影或配对之前 fail-closed，避免 BO5 被隐式降级或忽略。
  if (stageMatchFormat !== "bo1" && stageMatchFormat !== "bo3") {
    throw new Error("Major Swiss stages do not support bo5 matchFormat");
  }
  const projection = projectMajorSwissStage(input);

  if (projection.finalizedRound === MAJOR_SWISS_MAX_ROUND) {
    throw new Error("stage already complete (finalizedRound 5); no next round exists");
  }
  const nextRound = (projection.finalizedRound + 1) as MajorSwissRound;

  // 按 exact record 分组：`${wins}-${losses}`
  const groups = new Map<string, MajorSwissTeamState[]>();
  for (const team of projection.active) {
    const key = `${team.wins}-${team.losses}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [team]);
    } else {
      group.push(team);
    }
  }

  // 校验 active distribution（不符合即 throw，不 repair）
  const expected = EXPECTED_ACTIVE_DISTRIBUTION[nextRound];
  const actualDistribution: Record<string, number> = {};
  for (const [key, teamGroup] of groups) {
    actualDistribution[key] = teamGroup.length;
  }
  const allKeys = new Set([...Object.keys(expected), ...Object.keys(actualDistribution)]);
  const distributionMatches = [...allKeys].every(
    (key) => expected[key] === actualDistribution[key],
  );
  if (!distributionMatches) {
    throw new Error(
      `invalid active distribution for round ${nextRound}: ` +
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actualDistribution)}`,
    );
  }

  // group 顺序：wins DESC, losses ASC
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const recordA = parseRecordKey(a[0]);
    const recordB = parseRecordKey(b[0]);
    return recordB.wins - recordA.wins || recordA.losses - recordB.losses;
  });

  const pairings: MajorSwissPairing[] = [];

  for (const [key, group] of sortedGroups) {
    const record = parseRecordKey(key);
    const sortedBySeed = [...group].sort((a, b) => a.currentStageSeed - b.currentStageSeed);

    if (nextRound === 1) {
      // R1：initial stage seed 1v9 .. 8v16
      for (let i = 0; i < MAJOR_SWISS_TEAM_COUNT / 2; i += 1) {
        const higher = sortedBySeed[i];
        const lower = sortedBySeed[i + MAJOR_SWISS_TEAM_COUNT / 2];
        pairings.push({
          round: nextRound,
          record: { ...record },
          higherSeedTeamId: higher.teamId,
          lowerSeedTeamId: lower.teamId,
          higherSeed: higher.currentStageSeed,
          lowerSeed: lower.currentStageSeed,
          format: getMajorSwissRequiredFormat(stageMatchFormat, record),
          pairingRule: "initial",
        });
      }
    } else if (nextRound === 2 || nextRound === 3) {
      // R2/R3：feasibility-aware high-low。
      // highest 优先 lowest feasible non-rematch opponent：
      // candidate 必须满足「选中后剩余队伍仍存在完整 zero-rematch matching」，
      // 否则继续向 higher seed 尝试。整个 group 确实不存在完整 matching 才 fail-closed。
      const available = [...sortedBySeed];
      while (available.length > 0) {
        const higher = available.shift()!;
        let lowerIndex = -1;
        for (let i = available.length - 1; i >= 0; i -= 1) {
          if (available[i].opponents.includes(higher.teamId)) continue;
          const rest = available.filter((_, index) => index !== i);
          if (hasCompleteNonRematchMatching(rest)) {
            lowerIndex = i;
            break;
          }
        }
        if (lowerIndex === -1) {
          throw new Error(
            `no complete zero-rematch pairing exists for the ${record.wins}-${record.losses} group`,
          );
        }
        const [lower] = available.splice(lowerIndex, 1);
        pairings.push({
          round: nextRound,
          record: { ...record },
          higherSeedTeamId: higher.teamId,
          lowerSeedTeamId: lower.teamId,
          higherSeed: higher.currentStageSeed,
          lowerSeed: lower.currentStageSeed,
          format: getMajorSwissRequiredFormat(stageMatchFormat, record),
          pairingRule: "high-low",
        });
      }
    } else {
      // R4/R5：six-team priority patterns
      if (sortedBySeed.length !== 6) {
        throw new Error(`round ${nextRound} requires exactly 6 teams per record group`);
      }
      const priorMatches: { entryAId: string; entryBId: string }[] = [];
      for (const team of projection.teams) {
        for (const opponentId of team.opponents) {
          if (team.teamId < opponentId) {
            priorMatches.push({ entryAId: team.teamId, entryBId: opponentId });
          }
        }
      }
      const selected = selectMajorSixTeamPairingPattern(
        sortedBySeed.map((team) => team.teamId),
        priorMatches,
      );
      const seedOf = new Map(sortedBySeed.map((team) => [team.teamId, team.currentStageSeed]));
      for (const pair of selected.pairs) {
        pairings.push({
          round: nextRound,
          record: { ...record },
          higherSeedTeamId: pair.higherSeedTeamId,
          lowerSeedTeamId: pair.lowerSeedTeamId,
          higherSeed: seedOf.get(pair.higherSeedTeamId)!,
          lowerSeed: seedOf.get(pair.lowerSeedTeamId)!,
          format: getMajorSwissRequiredFormat(stageMatchFormat, record),
          pairingRule: "six-team-priority",
          priority: selected.priority,
        });
      }
    }
  }

  return pairings;
}

// ── Qualifiers ──────────────────────────────────────────

export function getMajorSwissQualifiers(
  projection: MajorSwissProjection,
): readonly MajorSwissQualifier[] {
  if (!projection.isComplete || projection.finalizedRound !== MAJOR_SWISS_MAX_ROUND) {
    throw new Error("qualifiers are only defined for a complete stage (finalizedRound === 5)");
  }
  if (projection.advanced.length !== MAJOR_SWISS_ADVANCE_COUNT) {
    throw new Error(
      `expected exactly ${MAJOR_SWISS_ADVANCE_COUNT} advanced teams, got ${projection.advanced.length}`,
    );
  }

  const qualifiers = projection.advanced.map((team) => ({
    teamId: team.teamId,
    finalStageSeed: team.currentStageSeed,
  }));
  for (let index = 0; index < qualifiers.length; index += 1) {
    if (qualifiers[index].finalStageSeed !== index + 1) {
      throw new Error(
        `advanced final stage seeds must be 1..${MAJOR_SWISS_ADVANCE_COUNT}, ` +
          `got ${qualifiers[index].finalStageSeed} at rank ${index + 1}`,
      );
    }
  }
  return qualifiers;
}
