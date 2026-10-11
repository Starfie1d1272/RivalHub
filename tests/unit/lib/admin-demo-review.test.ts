import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import type { matchDemoImports } from "@/db/schema";
import type { CanonicalTarget } from "@/lib/demo-integration/validation";
import type { GameplayIdentityReviewDetail } from "@/lib/identity/gameplay-steam";
const mocks = vi.hoisted(() => ({ read: vi.fn(), validate: vi.fn(), details: vi.fn(), profiles: vi.fn(), capture: vi.fn() }));
vi.mock("@/lib/observability/context", () => ({ ensureRequestId: () => "review-request-123" }));
vi.mock("@/lib/observability/server", () => ({ captureException: mocks.capture }));
vi.mock("@/lib/demo-integration/review", () => ({ readStoredEvidence: mocks.read }));
vi.mock("@/lib/demo-integration/validation", async (original) => ({ ...await original<object>(), validateCanonicalTarget: mocks.validate }));
vi.mock("@/lib/identity/gameplay-steam", () => ({ loadGameplayIdentityReviewDetails: mocks.details }));
vi.mock("@/lib/steam-profiles", () => ({ loadOrFetchSteamProfiles: mocks.profiles }));
import { loadAdminDemoReview } from "@/lib/admin/matches/demo-review";

const steam64 = "76561198123456789";
const row = { id: "import", seasonId: "season", issues: [{ code: "PARTICIPANT_NOT_IN_ROSTER", message: "stored", path: `participants.${steam64}` }] } as unknown as typeof matchDemoImports.$inferSelect;
const target = { match: { entryAId: "a", entryBId: "b" }, map: { id: "map", mapOrder: 1, mapName: "de_inferno" },
  roster: [{ userId: "starter", entryId: "a", eventRosterMemberId: "member", displayName: "本场首发", steam64: "76561198000000001" },
    { userId: "opponent", entryId: "b", eventRosterMemberId: "other", displayName: "另一队首发" }] } as CanonicalTarget;
const unresolved = { code: "PARTICIPANT_IDENTITY_UNRESOLVED", path: `participants.${steam64}`, message: "internal" };
const load = (eventRosterUserIdsByEntry: ReadonlyMap<string, ReadonlySet<string>> = new Map()) =>
  loadAdminDemoReview({} as TxDb, row, target, new Map([["a", "Alpha"]]), eventRosterUserIdsByEntry);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockReturnValue({ participants: [{ steamId64: steam64, nameSnapshot: "Demo player", observedTeamKey: "teamA" }] });
  mocks.validate.mockResolvedValue({ issues: [unresolved], resolutions: new Map() });
  mocks.details.mockResolvedValue(new Map());
  mocks.profiles.mockResolvedValue(new Map());
});

describe("admin Demo review projection", () => {
  it("uses current exact identity issue after retirement despite stale stored not-in-roster issue", async () => {
    const result = await load();
    expect(result.participants).toHaveLength(1);
    expect(result.participants[0]).toMatchObject({ state: "confirmable", candidates: [{ eventRosterMemberId: "member" }] });
  });
  it("does not use an unrelated participant issue to enable confirmation", async () => {
    mocks.validate.mockResolvedValue({ issues: [{ ...unresolved, path: "participants.someone-else" }], resolutions: new Map() });
    expect((await load()).participants[0]).toMatchObject({ state: "blocked", candidates: [] });
  });
  it("reduces normal participants to a count and projects score/QA without internal messages", async () => {
    mocks.validate.mockResolvedValue({ issues: [{ code: "SCORE_MISMATCH" }, { code: "DAK_QA_FAILED" }], resolutions: new Map([[steam64, { userId: "starter", source: "primary" }]]) });
    const result = await load();
    expect(result).toMatchObject({ resolvedCount: 1, participants: [], message: "请按下方检查结果处理这份 Demo。" });
    expect(result.blockingIssues).toEqual(["Demo 回合比分与正式比分不一致，请核对本图赛果。", "请在 Uploader 查看 DAK 检查结果，处理后重新解析并同步。"]);
  });
  it("classifies a resolved same-team EventRoster member outside the recorded starters as a lineup mismatch", async () => {
    const detail: GameplayIdentityReviewDetail = { userId: "substitute", name: "替补选手", source: "primary", identity: null };
    mocks.validate.mockResolvedValue({
      issues: [
        { code: "PARTICIPANT_NOT_IN_ROSTER", path: `participants.${steam64}`, message: "internal" },
        { code: "ROSTER_PARTICIPANT_MISSING", message: "internal" },
      ],
      resolutions: new Map([[steam64, detail]]),
    });
    mocks.details.mockResolvedValue(new Map([[steam64, detail]]));

    const result = await load(new Map([["a", new Set(["starter", "substitute"])]]));
    expect(result.participants[0]).toMatchObject({
      state: "roster-mismatch",
      currentPlayer: { userId: "substitute", name: "替补选手" },
      candidates: [],
      retirableIdentityId: null,
    });
    expect(result.message).toBe("需要处理：1 名选手实际出场与本场记录首发不一致");
    expect(result.participants[0]?.note).toContain("通过本场首发管理处理差异");
  });

  it.each([
    ["primary", null, "conflict-nonretirable"],
    ["gameplay_alias", { identityId: "identity", provenance: "profile_change", status: "active", sourceSeasonId: "season" }, "conflict-nonretirable"],
    ["gameplay_alias", { identityId: "identity", provenance: "admin_confirmed_alternate", status: "active", sourceSeasonId: "elsewhere" }, "conflict-nonretirable"],
    ["gameplay_alias", { identityId: "identity", provenance: "admin_confirmed_alternate", status: "retired", sourceSeasonId: "season" }, "conflict-nonretirable"],
    ["gameplay_alias", { identityId: "identity", provenance: "admin_confirmed_alternate", status: "active", sourceSeasonId: "season" }, "conflict-retirable"],
  ] as const)("scopes conflict controls for %s / %j", async (source, identity, state) => {
    const detail: GameplayIdentityReviewDetail = { userId: "opponent", name: "当前关联选手", source, identity };
    mocks.validate.mockResolvedValue({ issues: [{ code: "PARTICIPANT_TEAM_MISMATCH", path: `participants.${steam64}` }], resolutions: new Map([[steam64, detail]]) });
    mocks.details.mockResolvedValue(new Map([[steam64, detail]]));
    expect((await load()).participants[0]).toMatchObject({ state, currentPlayer: { userId: "opponent", name: "当前关联选手" }, retirableIdentityId: state === "conflict-retirable" ? "identity" : null });
  });
  it("keeps invalid evidence visible and does not load identity controls", async () => {
    mocks.read.mockImplementation(() => { throw new Error("invalid"); });
    expect(await load()).toMatchObject({ invalidPayload: true, participants: [], message: "这份 Demo 数据无法重新读取，请核对或拒绝。排查编号：review-request-123" });
    expect(mocks.validate).not.toHaveBeenCalled();
  });
  it("fails closed when canonical resolution fails", async () => {
    const cause = new Error("private inner failure");
    const error = new Error("dirty cross-user identity", {cause});
    mocks.validate.mockRejectedValue(error);
    const result = await load();
    expect(result).toMatchObject({ participants: [], resolvedCount: 0 });
    expect(result.message).toContain("review-request-123");
    expect(JSON.stringify(result)).not.toContain("private inner failure");
    expect(mocks.capture).toHaveBeenCalledWith("demo.review.read_failed", error, expect.objectContaining({requestId:"review-request-123",errorCode:"DEMO_REVIEW_READ_FAILED",safeContext:{phase:"canonical-validation",importId:"import"}}));
    expect(mocks.details).not.toHaveBeenCalled();
  });

  it("preserves distinct unknown current and historical diagnostics without changing blockers or identity controls", async () => {
    mocks.validate.mockResolvedValue({issues:[unresolved,{code:"FUTURE_CHECK_A",path:"target.mapName",message:"private details"},{code:"FUTURE_CHECK_B",path:"sourceFacts.rounds[0]",message:"private details"}],resolutions:new Map()});
    const result = await loadAdminDemoReview({} as TxDb, {...row,issues:[...row.issues,{code:"STORED_FUTURE_CHECK",path:"target.stageKey",message:"private stored details"}]},target,new Map());
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({source:"current",code:"FUTURE_CHECK_A",path:"target.mapName"}),
      expect.objectContaining({source:"current",code:"FUTURE_CHECK_B",path:"sourceFacts.rounds[0]"}),
      expect.objectContaining({source:"stored",code:"PARTICIPANT_NOT_IN_ROSTER"}),
      expect.objectContaining({source:"stored",code:"STORED_FUTURE_CHECK",path:"target.stageKey"}),
    ]));
    expect(result.blockingIssues).toHaveLength(1);
    expect(result.participants[0]).toMatchObject({state:"confirmable",candidates:[{eventRosterMemberId:"member"}]});
    expect(JSON.stringify(result)).not.toContain("private details");
    expect(JSON.stringify(result)).not.toContain("private stored details");
  });
  it("does not project unbounded or unsafe diagnostic tokens", async () => {
    mocks.validate.mockResolvedValue({issues:[{code:"x".repeat(101),path:"https://private.example/token=secret",message:"secret"}],resolutions:new Map()});
    const result = await load();
    expect(result.diagnostics?.[0]).toMatchObject({code:"UNSAFE_ISSUE_CODE",path:undefined});
    expect(JSON.stringify(result)).not.toContain("private.example");
  });

  it("projects observed official Steam profile when available without altering validation", async () => {
    mocks.profiles.mockResolvedValue(new Map([
      [steam64, {
        steam64,
        personaName: "Official Steam Name",
        profileUrl: `https://steamcommunity.com/profiles/${steam64}`,
        avatarUrl: "https://avatars.steamstatic.com/avatar.jpg",
      }],
    ]));

    const result = await load();
    expect(result.participants[0]).toMatchObject({
      observedSteam64: steam64,
      demoName: "Demo player",
      state: "confirmable",
      observedSteamProfile: {
        personaName: "Official Steam Name",
        profileUrl: `https://steamcommunity.com/profiles/${steam64}`,
        avatarUrl: "https://avatars.steamstatic.com/avatar.jpg",
      },
    });
    expect(mocks.profiles).toHaveBeenCalledWith(expect.anything(), [steam64]);
  });

  it("degrades gracefully to null observedSteamProfile when profile is not found or provider fails", async () => {
    mocks.profiles.mockResolvedValue(new Map());

    const result = await load();
    expect(result.participants[0]).toMatchObject({
      observedSteam64: steam64,
      demoName: "Demo player",
      state: "confirmable",
      observedSteamProfile: null,
    });
  });
});
