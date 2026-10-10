import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Match as DbMatch, MatchMap } from "@/db/schema";
import type { CompetitionMatch } from "@/lib/matches/competition-context";
type Match = CompetitionMatch<DbMatch>;
import type { DemoImportMetadata } from "@/lib/demo-integration/metadata";
import { CURRENT_DAK_SEMANTIC_PROFILE } from "@/lib/demo-integration/semantic-profile";
import type { EffectiveMatchRosterPlayer } from "@/lib/match-rosters/effective";

const mocks = vi.hoisted(() => ({ select: vi.fn(), live: vi.fn(), major: vi.fn(), qualification: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/admin/matches/operator-evidence", () => ({ loadOperatorEvidence: vi.fn().mockResolvedValue(null) }));
vi.mock("@/db/client", () => ({ db: { select: mocks.select, query: { competitionQualificationRuns: { findFirst: mocks.run }, matchLiveSessions: { findFirst: mocks.live } } } }));
vi.mock("@/lib/matches/stage-read-model", () => ({ loadMajorSwissStageReadModel: mocks.major }));
vi.mock("@/lib/matches/qualification-stage-read-model", () => ({ loadQualificationSwissStageReadModel: mocks.qualification }));
vi.mock("@/lib/demo-integration/revision", () => ({ buildEvidenceRevisionForTarget: () => "current" }));

import { loadOperatorContext } from "@/lib/admin/matches/operator-context";

const match = { id: "match", seasonId: "season", stage: "play-in", status: "in_progress", ownership: "manual", qualificationRunId: "qual-run", round: 1, entryRound: null, isForfeit: false } as Match;
const map = { id: "map", matchId: "match", mapOrder: 1, mapName: "de_nuke", teamAStartSide: null, scoreA: null, scoreB: null, completedAt: null } as MatchMap;
const input = { match, maps: [map], imports: [], roster: [], seasonName: "Major", stageName: null, isSwiss: false, teamAName: "Alpha", teamBName: "Beta", vetoComplete: true };

describe("authorized operator context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([]) }) });
    mocks.live.mockResolvedValue(undefined);
    mocks.major.mockResolvedValue(null);
    mocks.qualification.mockResolvedValue(null);
    mocks.run.mockResolvedValue(null);
  });

  it("uses Qualification's canonical Swiss record even when Play-in is absent from stagePlan", async () => {
    mocks.qualification.mockResolvedValue({ stageName: "Play-in · Short Swiss", rounds: [{ groups: [{ record: "0:0", matchups: [{ matchId: "match" }] }] }] });
    const result = await loadOperatorContext(input);
    expect(mocks.qualification).toHaveBeenCalledWith("season");
    expect(mocks.major).not.toHaveBeenCalled();
    expect(result.roomGuide?.fields.filter(field => field.copyable).slice(0, 2).map(({ label, value }) => ({ label, value }))).toEqual([{ label: "轮次", value: "Play-in · Short Swiss" }, { label: "比赛短描述", value: "0-0" }]);
  });


  it("uses canonical Direct BO3 qualification instead of requiring a Swiss record", async () => {
    mocks.run.mockResolvedValue({ format: "direct_bo3" });
    const result = await loadOperatorContext(input);
    expect(result.roomGuide?.fields.filter(field => field.copyable).slice(0, 2).map(({ label, value }) => ({ label, value }))).toEqual([{ label: "轮次", value: "Play-in" }, { label: "比赛短描述", value: "第 1 轮" }]);
  });

  it("leaves unknown stage and Swiss record uncopyable rather than inventing room data", async () => {
    const result = await loadOperatorContext(input);
    expect(result.roomGuide?.fields.filter(field => field.copyable).slice(0, 2).map(({ label, value }) => ({ label, value })).every(field => field.value === null)).toBe(true);
  });

  it("binds scoreboard completion to ten effective starters and only offers canonical completed maps", async () => {
    const roster = Array.from({ length: 10 }, (_, i) => ({ userId: `player-${i}`, isStarter: true })) as EffectiveMatchRosterPlayer[];
    const rows = roster.map(player => ({ matchId: "match", mapId: "map", userId: player.userId, perfectName: player.userId, kills: 10, deaths: 10, assists: 0, hsPercent: 0, firstKills: 0, multiKills: 0, clutches: 0, adr: 50, ratingPro: 1, rws: 0, we: 0 }));
    mocks.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve(rows) }) });
    const completed = { ...map, scoreA: 13, scoreB: 5, completedAt: new Date("2026-10-01T13:00:00Z") };
    const result = await loadOperatorContext({ ...input, roster, match: { ...match, status: "finished" }, maps: [completed] });
    expect(result.workflow.completedMaps[0]).toMatchObject({ scoreboardComplete: true, completedAt: "2026-10-01T13:00:00.000Z" });
    expect((await loadOperatorContext({ ...input, roster, maps: [{ ...completed, completedAt: null }] })).workflow.completedMaps).toEqual([]);
    rows[0].userId = "unbound-user";
    expect((await loadOperatorContext({ ...input, roster, maps: [completed] })).workflow.completedMaps[0].scoreboardComplete).toBe(false);
  });

  it("uses accepted gameplay phase only, without interpreting a waiting session as a live start", async () => {
    const source = { id: "session", currentMapId: "map", mapEpoch: 1, manualTakeoverMapEpoch: null, identityHealth: "healthy", lineupHealth: "healthy", continuityHealth: "healthy", autoCanonicalizationArmed: true };
    mocks.live.mockResolvedValue({ ...source, mapExecutionPhase: "waiting" });
    expect((await loadOperatorContext(input)).workflow.phase).toBe("awaiting_gameplay");
    mocks.live.mockResolvedValue({ ...source, mapExecutionPhase: "gameplay" });
    expect((await loadOperatorContext(input)).workflow.phase).toBe("gameplay");
  });
});

it.each([
  ["pending", "处理中", false],
  ["needs_attention", "待审核", false],
  ["rejected", "导入失败 / 已驳回", false],
  ["confirmed", "已同步", true],
] as const)("distinguishes Demo %s without inventing another completion rule", async (status, label, complete) => {
  const imports = [{ matchMapId: "map", status, semanticProfile: CURRENT_DAK_SEMANTIC_PROFILE, evidenceRevision: "current" }] as DemoImportMetadata[];
  const result = await loadOperatorContext({ ...input, match: { ...match, status: "finished" }, maps: [{ ...map, scoreA: 13, scoreB: 5, completedAt: new Date("2026-10-01T13:00:00Z") }], imports });
  expect(result.workflow.completedMaps[0]).toMatchObject({ demoLabel: label, demoComplete: complete });
  expect(result.workflow.completedMaps[0]?.demoReviewAnchor).toBe(status === "needs_attention" ? "demo-review-map" : undefined);
});
