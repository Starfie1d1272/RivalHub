import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";
import { mockUserSession, createFakeSeason, resetAuditTracking } from "tests/helpers";

// ── 合法 UUID 常量 ─────────────────────────────────────────────────────────────
const SEASON_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

// ── hoisted mock refs ──────────────────────────────────────────────────────────
const {
  seasonFindFirstMock,
  userFindFirstMock,
  registrationFindFirstMock,
  registrationDraftFindFirstMock,
  selectMock,
  updateMock,
  insertMock,
  deleteMock,
  transactionMock,
  insertValuesCalls,
  getRegistrationWindowStateMock,
  getUserSessionMock,
  assertSteam64AvailableMock,
  changePrimarySteam64InTxMock,
  getSteamProfileForPrimaryMock,
  upsertSteamProfileMock,
  revalidatePathMock,
  assertUsersNotBlockedInTxMock,
} = vi.hoisted(() => {
  const insertValuesCalls: unknown[] = [];
  return {
    seasonFindFirstMock: vi.fn(),
    userFindFirstMock: vi.fn(),
    registrationFindFirstMock: vi.fn(),
    registrationDraftFindFirstMock: vi.fn(),
    selectMock: vi.fn(),
    updateMock: vi.fn(),
    insertMock: vi.fn(),
    deleteMock: vi.fn(),
    transactionMock: vi.fn(),
    insertValuesCalls,
    getRegistrationWindowStateMock: vi.fn(),
    getUserSessionMock: vi.fn(),
    assertSteam64AvailableMock: vi.fn(),
    changePrimarySteam64InTxMock: vi.fn(),
    getSteamProfileForPrimaryMock: vi.fn(),
    upsertSteamProfileMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    assertUsersNotBlockedInTxMock: vi.fn(),
  };
});

// ── mocks ─────────────────────────────────────────────────────────────────────
vi.mock("@/db/client", () => ({
  db: {
    query: {
      seasons: { findFirst: seasonFindFirstMock },
      users: { findFirst: userFindFirstMock },
      seasonRegistrations: { findFirst: registrationFindFirstMock },
      registrationDrafts: { findFirst: registrationDraftFindFirstMock },
    },
    select: selectMock,
    update: updateMock,
    insert: insertMock,
    delete: deleteMock,
    transaction: transactionMock,
  },
}));

vi.mock("@/lib/registration/window", () => ({
  getRegistrationWindowState: getRegistrationWindowStateMock,
}));

vi.mock("@/lib/auth/session", () => ({
  getUserSession: getUserSessionMock,
}));

vi.mock("@/lib/identity/write-lock", () => ({ lockGameplayIdentityWriteInTx: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/identity/gameplay-steam", () => ({
  assertSteam64Available: assertSteam64AvailableMock,
  changePrimarySteam64InTx: changePrimarySteam64InTxMock,
}));

vi.mock("@/lib/steam-profiles", () => ({
  getSteamProfileForPrimary: getSteamProfileForPrimaryMock,
  upsertSteamProfile: upsertSteamProfileMock,
}));

vi.mock("@/lib/discipline/service", () => ({
  assertUsersNotBlockedInTx: assertUsersNotBlockedInTxMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
  updateTag: vi.fn(),
}));

// ── import after mocks ─────────────────────────────────────────────────────────
import { loadRegistrationDraft, submitRegistration } from "@/actions/register";

// ── 公共测试数据 ──────────────────────────────────────────────────────────────
const SEASON = createFakeSeason({
  id: SEASON_ID,
  slug: "spring-2026",
  status: "registration",
  registrationOpensAt: null,
  registrationOpenedAt: null,
  registrationClosesAt: null,
  rosterChangeClosesAt: null,
  registrationConfig: null,
  positions: ["opener", "closer", "anchor"],
});

const SESSION = mockUserSession({ userId: USER_ID, email: "player@example.com" });

// VALID_INPUT 的 seasonId 必须是合法 UUID（registrationSeedSchema 用 z.guid()）
const VALID_INPUT = {
  seasonId: SEASON_ID,
  email: "player@example.com",
  studentId: "220000001",
  playerType: "enrolled",
  qq: "12345678",
  perfectName: "TestPlayer",
  steam64: "76561198000000001",
  primaryPosition: "opener",
  secondaryPosition: "closer",
  peakRank: "A+",
  peakRankSeason: "S1 2026",
  peakRating: 1.5,
  currentSeasonPeakRank: "A",
  currentRating: 1.4,
  screenshotUrls: ["https://njubox.example.com/ss1"],
  mapPreferences: [
    { map: "de_mirage", level: "strong" },
    { map: "de_inferno", level: "proficient" },
    { map: "de_nuke", level: "playable" },
    { map: "de_ancient", level: "basic" },
    { map: "de_dust2", level: "basic" },
    { map: "de_anubis", level: "basic" },
    { map: "de_cache", level: "none" },
  ],
  gameplayStyle: "积极型",
  competitionHistory: "参加过校赛",
  willingToBeCaptain: false,
  antiCheatPledge: true as const,
};

// ── 工具：mock db.select 链式调用返回 [{count: N}] ──────────────────────────

// ── 工具：mock db.update(users).set.where.returning ─────────────────────────

// ── 工具：setup 公共 happy-path 前置 mock（season + window + session）────────

// ─────────────────────────────────────────────────────────────────────────────
describe("submitRegistration()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      select: selectMock,
      update: updateMock,
      insert: insertMock,
      delete: deleteMock,
    }));
    resetAuditTracking(insertValuesCalls);
    assertSteam64AvailableMock.mockResolvedValue(undefined);
    changePrimarySteam64InTxMock.mockResolvedValue(undefined);
    getSteamProfileForPrimaryMock.mockResolvedValue({
      steam64: VALID_INPUT.steam64,
      personaName: "Official test steam",
      profileUrl: "https://steamcommunity.com/profiles/76561198000000001",
      avatarUrl: "https://avatars.steamstatic.com/test.jpg",
    });
    upsertSteamProfileMock.mockResolvedValue(undefined);
    assertUsersNotBlockedInTxMock.mockResolvedValue(undefined);
  });

  it("未登录（session 为 null）返回 UNAUTHORIZED", async () => {
    seasonFindFirstMock.mockResolvedValue(SEASON);
    getRegistrationWindowStateMock.mockReturnValue({ canSubmit: true });
    getUserSessionMock.mockResolvedValue(null);

    const result = await submitRegistration(VALID_INPUT as never);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.UNAUTHORIZED);
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────

describe("loadRegistrationDraft()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserSessionMock.mockResolvedValue(SESSION);
  });

  it("只允许读取当前登录账号的报名草稿", async () => {
    const result = await loadRegistrationDraft(SEASON_ID, "other@example.com");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCode.FORBIDDEN);
    expect(seasonFindFirstMock).not.toHaveBeenCalled();
    expect(registrationDraftFindFirstMock).not.toHaveBeenCalled();
  });
});
