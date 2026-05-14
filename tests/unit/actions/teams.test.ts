import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";
import { mockUserSession, expectAuditLog, resetAuditTracking } from "tests/helpers";

// ── hoisted mock refs ──────────────────────────────────────────────────────────
const {
  // outside-tx query mocks (used by uploadTeamLogo)
  teamFindFirstMock,
  registrationFindFirstMock,
  seasonFindFirstMock,
  // inside-tx mocks (used by both uploadTeamLogo and updateTeamName)
  txTeamFindFirstMock,
  txRegistrationFindFirstMock,
  txSeasonFindFirstMock,
  txUpdateMock,
  txInsertMock,
  transactionMock,
  // supabase storage
  supabaseUploadMock,
  supabaseGetPublicUrlMock,
  // other
  revalidatePathMock,
  revalidateSeasonPathsMock,
  // tracking
  txUpdateSetCalls,
  txInsertValuesCalls,
} = vi.hoisted(() => {
  const txUpdateSetCalls: unknown[] = [];
  const txInsertValuesCalls: unknown[] = [];
  return {
    teamFindFirstMock: vi.fn(),
    registrationFindFirstMock: vi.fn(),
    seasonFindFirstMock: vi.fn(),
    txTeamFindFirstMock: vi.fn(),
    txRegistrationFindFirstMock: vi.fn(),
    txSeasonFindFirstMock: vi.fn(),
    txUpdateMock: vi.fn(),
    txInsertMock: vi.fn(),
    transactionMock: vi.fn(),
    supabaseUploadMock: vi.fn(),
    supabaseGetPublicUrlMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    revalidateSeasonPathsMock: vi.fn(),
    txUpdateSetCalls,
    txInsertValuesCalls,
  };
});

// ── mocks ─────────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn(),
  auditActorId: vi.fn((session: { userId: string }) => session.userId),
}));

vi.mock("@/lib/auth/supabase", () => ({
  createServiceClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: supabaseUploadMock,
        getPublicUrl: supabaseGetPublicUrlMock,
      })),
    },
  })),
}));

vi.mock("@/lib/revalidation", () => ({
  revalidateSeasonPaths: revalidateSeasonPathsMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/db/client", () => {
  const tx = {
    query: {
      teams: { findFirst: txTeamFindFirstMock },
      seasonRegistrations: { findFirst: txRegistrationFindFirstMock },
      seasons: { findFirst: txSeasonFindFirstMock },
    },
    update: txUpdateMock,
    insert: txInsertMock,
  };

  return {
    db: {
      query: {
        teams: { findFirst: teamFindFirstMock },
        seasonRegistrations: { findFirst: registrationFindFirstMock },
        seasons: { findFirst: seasonFindFirstMock },
      },
      transaction: transactionMock.mockImplementation(
        (callback) => callback(tx),
      ),
    },
  };
});

// ── import after mocks ─────────────────────────────────────────────────────────
import { uploadTeamLogo, updateTeamName } from "@/actions/teams";
import { requireAuth } from "@/lib/auth/session";

// ── constants ──────────────────────────────────────────────────────────────────
const TEAM_ID = "team-1";
const SEASON_ID = "season-1";
const SEASON_SLUG = "spring-2026";
const CAPTAIN_REG_ID = "reg-captain";
const USER_ID = "user-1";

// ── shared setup helpers ───────────────────────────────────────────────────────
function setupAuth() {
  vi.mocked(requireAuth).mockResolvedValue(
    mockUserSession({ userId: USER_ID, email: "captain@test.com" }),
  );
}

function setupOutsideTxTeam(overrides?: Record<string, unknown>) {
  teamFindFirstMock.mockResolvedValue({
    id: TEAM_ID,
    seasonId: SEASON_ID,
    name: "Test Team",
    captainRegistrationId: CAPTAIN_REG_ID,
    logoUrl: null,
    ...overrides,
  });
}

function setupOutsideTxRegistration(overrides?: Record<string, unknown>) {
  registrationFindFirstMock.mockResolvedValue({
    id: CAPTAIN_REG_ID,
    userId: USER_ID,
    seasonId: SEASON_ID,
    ...overrides,
  });
}

function setupOutsideTxSeason(overrides?: Record<string, unknown>) {
  seasonFindFirstMock.mockResolvedValue({
    id: SEASON_ID,
    slug: SEASON_SLUG,
    ...overrides,
  });
}

function setupTxTeam(overrides?: Record<string, unknown>) {
  txTeamFindFirstMock.mockResolvedValue({
    id: TEAM_ID,
    seasonId: SEASON_ID,
    name: "Test Team",
    captainRegistrationId: CAPTAIN_REG_ID,
    logoUrl: null,
    ...overrides,
  });
}

function setupTxRegistration(overrides?: Record<string, unknown>) {
  txRegistrationFindFirstMock.mockResolvedValue({
    id: CAPTAIN_REG_ID,
    userId: USER_ID,
    seasonId: SEASON_ID,
    ...overrides,
  });
}

function setupTxSeason(overrides?: Record<string, unknown>) {
  txSeasonFindFirstMock.mockResolvedValue({
    id: SEASON_ID,
    slug: SEASON_SLUG,
    ...overrides,
  });
}

function setupTxWriteMocks() {
  txUpdateMock.mockImplementation(() => ({
    set: vi.fn((values: unknown) => {
      txUpdateSetCalls.push(values);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));
  txInsertMock.mockImplementation(() => ({
    values: vi.fn((values: unknown) => {
      txInsertValuesCalls.push(values);
      return Promise.resolve();
    }),
  }));
}

function setupSupabaseSuccess() {
  supabaseUploadMock.mockResolvedValue({ error: null });
  supabaseGetPublicUrlMock.mockReturnValue({
    data: { publicUrl: "https://example.com/logo.png" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe("uploadTeamLogo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(txInsertValuesCalls);
    txUpdateSetCalls.length = 0;
    setupAuth();
    setupTxWriteMocks();
  });

  it("no file → fail", async () => {
    const fd = new FormData();
    const result = await uploadTeamLogo(TEAM_ID, fd);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(result.error.message).toContain("未提供文件");
    }
  });

  it("wrong type → fail", async () => {
    const fd = new FormData();
    fd.append("file", new File(["test"], "test.gif", { type: "image/gif" }));
    const result = await uploadTeamLogo(TEAM_ID, fd);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("team not found → fail", async () => {
    teamFindFirstMock.mockResolvedValue(null);

    const fd = new FormData();
    fd.append("file", new File(["test"], "test.png", { type: "image/png" }));
    const result = await uploadTeamLogo(TEAM_ID, fd);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.NOT_FOUND);
      expect(result.error.message).toContain("队伍不存在");
    }
  });

  it("not captain → fail", async () => {
    setupOutsideTxTeam();
    registrationFindFirstMock.mockResolvedValue(null); // not registered
    setupOutsideTxSeason();

    const fd = new FormData();
    fd.append("file", new File(["test"], "test.png", { type: "image/png" }));
    const result = await uploadTeamLogo(TEAM_ID, fd);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.FORBIDDEN);
    }
  });

  it("success → ok + audit", async () => {
    setupOutsideTxTeam();
    setupOutsideTxRegistration();
    setupOutsideTxSeason();
    setupSupabaseSuccess();

    const fd = new FormData();
    fd.append("file", new File(["test"], "test.png", { type: "image/png" }));
    const result = await uploadTeamLogo(TEAM_ID, fd);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logoUrl).toBe("https://example.com/logo.png");
    }

    expectAuditLog(txInsertValuesCalls, "team.upload_logo", {
      actorId: USER_ID,
      targetId: TEAM_ID,
      targetType: "team",
      seasonId: SEASON_ID,
    });

    expect(revalidateSeasonPathsMock).toHaveBeenCalledWith(SEASON_SLUG, ["teams"]);
    expect(revalidatePathMock).toHaveBeenCalledWith(`/${SEASON_SLUG}/teams/${TEAM_ID}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("updateTeamName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(txInsertValuesCalls);
    txUpdateSetCalls.length = 0;
    setupAuth();
    setupTxWriteMocks();
  });

  it("too short → fail", async () => {
    const result = await updateTeamName(TEAM_ID, "X");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("too long → fail", async () => {
    const result = await updateTeamName(TEAM_ID, "A".repeat(33));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("team not found → fail", async () => {
    txTeamFindFirstMock.mockResolvedValue(null);

    const result = await updateTeamName(TEAM_ID, "Valid Name");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.NOT_FOUND);
      expect(result.error.message).toContain("队伍不存在");
    }
  });

  it("not captain → fail", async () => {
    setupTxTeam();
    txRegistrationFindFirstMock.mockResolvedValue({ id: "reg-other" });

    const result = await updateTeamName(TEAM_ID, "New Name");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.FORBIDDEN);
    }
    expect(txUpdateSetCalls).toEqual([]);
    expect(txInsertValuesCalls).toEqual([]);
  });

  it("success → ok + audit", async () => {
    setupTxTeam({ name: "Old Name" });
    setupTxRegistration();
    setupTxSeason();

    const result = await updateTeamName(TEAM_ID, "  New Name  ");

    expect(result.success).toBe(true);
    expect(txUpdateSetCalls).toContainEqual({ name: "New Name" });
    expectAuditLog(txInsertValuesCalls, "team.rename", {
      actorId: USER_ID,
      targetId: TEAM_ID,
      targetType: "team",
      seasonId: SEASON_ID,
    });

    expect(revalidateSeasonPathsMock).toHaveBeenCalledWith(SEASON_SLUG, [
      "teams",
      "draft",
      "draftCaptain",
    ]);
    expect(revalidatePathMock).toHaveBeenCalledWith(`/${SEASON_SLUG}/teams/${TEAM_ID}`);
  });

  it("same name → ok no-op", async () => {
    setupTxTeam({ name: "Same Name" });
    setupTxRegistration();
    setupTxSeason();

    const result = await updateTeamName(TEAM_ID, "Same Name");

    expect(result.success).toBe(true);
    expect(txUpdateSetCalls).toEqual([]);
    expect(txInsertValuesCalls).toEqual([]);
  });
});
