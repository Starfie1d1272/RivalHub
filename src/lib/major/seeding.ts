// RivalHub 2.0 — Major Stage seeding（stage-local initial seed 构造）。
//
// 只负责不同 Major Stage 之间的 initial stage seed 构造：
// tournament-level seed → stage-local seed 1..16。
//
// 不 import StageConfig / Season / DB。
// 不假设 tournament seed 恰好是 1..8 / 9..16 / 17..32，
// 只通过排序得到相对顺序。

import { MAJOR_SWISS_TEAM_COUNT } from "./swiss";
import type { MajorSwissEntrant } from "./swiss";

export interface MajorTournamentSeededTeam {
  teamId: string;

  /**
   * 赛事级 tournament seed。
   *
   * 可以是 1..32 或未来其它正整数排名。
   * 这里不等同于 stage-local seed。
   */
  tournamentSeed: number;
}

export interface MajorAdvancingTeam {
  teamId: string;

  /**
   * 上一个 Swiss Stage 的 finalStageSeed。
   */
  previousStageFinalSeed: number;
}

const HALF = MAJOR_SWISS_TEAM_COUNT / 2;

function assertValidTournamentTeam(
  team: MajorTournamentSeededTeam,
  teamIds: Set<string>,
  tournamentSeeds: Set<number>,
): void {
  if (typeof team.teamId !== "string" || team.teamId.length === 0) {
    throw new Error("teamId must be a non-empty string");
  }
  if (teamIds.has(team.teamId)) {
    throw new Error(`duplicate teamId: ${team.teamId}`);
  }
  teamIds.add(team.teamId);

  if (!Number.isInteger(team.tournamentSeed) || team.tournamentSeed <= 0) {
    throw new Error(
      `invalid tournamentSeed ${team.tournamentSeed}: must be a positive integer`,
    );
  }
  if (tournamentSeeds.has(team.tournamentSeed)) {
    throw new Error(`duplicate tournamentSeed: ${team.tournamentSeed}`);
  }
  tournamentSeeds.add(team.tournamentSeed);
}

export function seedMajorStageOneEntrants(
  teams: readonly MajorTournamentSeededTeam[],
): readonly MajorSwissEntrant[] {
  if (teams.length !== MAJOR_SWISS_TEAM_COUNT) {
    throw new Error(
      `stage one requires exactly ${MAJOR_SWISS_TEAM_COUNT} teams (got ${teams.length})`,
    );
  }

  const teamIds = new Set<string>();
  const tournamentSeeds = new Set<number>();
  for (const team of teams) {
    assertValidTournamentTeam(team, teamIds, tournamentSeeds);
  }

  // 按 tournamentSeed ASC 排序后规范化为 initialStageSeed 1..16
  const sorted = [...teams].sort((a, b) => a.tournamentSeed - b.tournamentSeed);
  return sorted.map((team, index) => ({
    teamId: team.teamId,
    initialStageSeed: index + 1,
  }));
}

export function seedMajorLaterStageEntrants(input: {
  directEntrants: readonly MajorTournamentSeededTeam[];
  advancingEntrants: readonly MajorAdvancingTeam[];
}): readonly MajorSwissEntrant[] {
  const { directEntrants, advancingEntrants } = input;

  if (directEntrants.length !== HALF) {
    throw new Error(`later stage requires exactly ${HALF} direct entrants (got ${directEntrants.length})`);
  }
  if (advancingEntrants.length !== HALF) {
    throw new Error(
      `later stage requires exactly ${HALF} advancing entrants (got ${advancingEntrants.length})`,
    );
  }

  // direct entrants：teamId 非空 / unique（跨两组）、tournamentSeed 正整数 / unique
  const teamIds = new Set<string>();
  const tournamentSeeds = new Set<number>();
  for (const team of directEntrants) {
    assertValidTournamentTeam(team, teamIds, tournamentSeeds);
  }

  // advancing entrants：teamId 非空 / 跨两组 unique、previousStageFinalSeed ∈ 1..8 / unique
  const finalSeeds = new Set<number>();
  for (const team of advancingEntrants) {
    if (typeof team.teamId !== "string" || team.teamId.length === 0) {
      throw new Error("teamId must be a non-empty string");
    }
    if (teamIds.has(team.teamId)) {
      throw new Error(`duplicate teamId across groups: ${team.teamId}`);
    }
    teamIds.add(team.teamId);

    const seed = team.previousStageFinalSeed;
    if (!Number.isInteger(seed) || seed < 1 || seed > HALF) {
      throw new Error(`invalid previousStageFinalSeed ${seed}: must be an integer in 1..${HALF}`);
    }
    if (finalSeeds.has(seed)) {
      throw new Error(`duplicate previousStageFinalSeed: ${seed}`);
    }
    finalSeeds.add(seed);
  }

  // 1–8 = 本阶段直接进入队（tournamentSeed ASC）
  // 9–16 = 上一阶段晋级队（previousStageFinalSeed ASC）
  const direct = [...directEntrants].sort((a, b) => a.tournamentSeed - b.tournamentSeed);
  const advancing = [...advancingEntrants].sort(
    (a, b) => a.previousStageFinalSeed - b.previousStageFinalSeed,
  );
  return [
    ...direct.map((team, index) => ({
      teamId: team.teamId,
      initialStageSeed: index + 1,
    })),
    ...advancing.map((team, index) => ({
      teamId: team.teamId,
      initialStageSeed: HALF + 1 + index,
    })),
  ];
}
