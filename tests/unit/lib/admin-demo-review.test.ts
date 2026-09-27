import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import type { matchDemoImports } from "@/db/schema";
import type { CanonicalTarget } from "@/lib/demo-integration/validation";
import type { GameplayIdentityReviewDetail } from "@/lib/identity/gameplay-steam";
const mocks = vi.hoisted(() => ({ read: vi.fn(), validate: vi.fn(), details: vi.fn(), profiles: vi.fn() }));
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
    expect(result).toMatchObject({ resolvedCount: 1, participants: [], message: "这份 Demo 当前不是 Steam 身份确认问题。" });
    expect(result.blockingIssues).toEqual(["Demo 回合比分与正式比分不一致，请核对本图赛果。", "DAK QA 未通过，本问题不能通过身份确认解决。"]);
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
    expect(result.participants[0]?.note).toContain("不是 Steam 身份冲突");
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
    expect(await load()).toMatchObject({ invalidPayload: true, participants: [], message: "这份 Demo 数据无法重新读取，请核对或拒绝。" });
    expect(mocks.validate).not.toHaveBeenCalled();
  });
  it("fails closed when canonical resolution fails", async () => {
    mocks.validate.mockRejectedValue(new Error("dirty cross-user identity"));
    expect(await load()).toMatchObject({ participants: [], resolvedCount: 0 });
    expect(mocks.details).not.toHaveBeenCalled();
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
