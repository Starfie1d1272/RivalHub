import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";
import { mockUserSession, expectAuditLog, resetAuditTracking } from "tests/helpers";

// ── hoisted mock refs ──────────────────────────────────────────────────────────
const {
  // outside-tx query mocks (used by uploadTeamLogo)
  teamFindFirstMock,
  seasonFindFirstMock,
  // inside-tx mocks (used by uploadTeamLogo)
  txTeamFindFirstMock,
  txSeasonFindFirstMock,
  txSelectMock,
  lockedTeam,
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
  const lockedTeam: { value: Record<string, unknown> | null } = { value: null };
  return {
    teamFindFirstMock: vi.fn(),
    seasonFindFirstMock: vi.fn(),
    txTeamFindFirstMock: vi.fn(),
    txSeasonFindFirstMock: vi.fn(),
    txSelectMock: vi.fn(),
    lockedTeam,
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
    execute: vi.fn().mockResolvedValue(undefined),
    select: txSelectMock,
    query: {
      teams: { findFirst: txTeamFindFirstMock },
      seasons: { findFirst: txSeasonFindFirstMock },
    },
    update: txUpdateMock,
    insert: txInsertMock,
  };

  return {
    db: {
      query: {
        teams: { findFirst: teamFindFirstMock },
        seasons: { findFirst: seasonFindFirstMock },
      },
      transaction: transactionMock.mockImplementation(
        (callback) => callback(tx),
      ),
    },
  };
});

// ── import after mocks ─────────────────────────────────────────────────────────
import { uploadTeamLogo } from "@/actions/teams";
import { requireAuth } from "@/lib/auth/session";

// ── constants ──────────────────────────────────────────────────────────────────
const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const SEASON_ID = "22222222-2222-4222-8222-222222222222";
const SEASON_SLUG = "spring-2026";
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
    name: "Test Team",
    captainUserId: USER_ID,
    status: "active",
    slug: "test-team",
    recruiting: false,
    description: null,
    logoUrl: null,
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
  lockedTeam.value = {
    id: TEAM_ID,
    name: "Test Team",
    captainUserId: USER_ID,
    status: "active",
    slug: "test-team",
    recruiting: false,
    description: null,
    logoUrl: null,
    ...overrides,
  };
  teamFindFirstMock.mockResolvedValue(lockedTeam.value);
  txTeamFindFirstMock.mockResolvedValue(lockedTeam.value);
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
      return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) };
    }),
  }));
  txSelectMock.mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ for: vi.fn(async () => lockedTeam.value ? [lockedTeam.value] : []) })),
    })),
  });
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
    setupOutsideTxTeam({ captainUserId: "other-user" }); // canonical captain mismatch

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
    setupOutsideTxSeason();
    setupTxTeam();
    setupSupabaseSuccess();

    const fd = new FormData();
    fd.append("file", new File(["test"], "test.png", { type: "image/png" }));
    const result = await uploadTeamLogo(TEAM_ID, fd);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logoUrl).toBe("https://example.com/logo.png");
    }

    expectAuditLog(txInsertValuesCalls, "team.logo.update", {
      actorId: USER_ID,
      targetId: TEAM_ID,
      targetType: "team",
      seasonId: null,
    });

    expect(revalidatePathMock).toHaveBeenCalledWith("/teams");
  });

  it("season has bracketData → logo upload unaffected", async () => {
    setupOutsideTxTeam();
    setupOutsideTxSeason({ bracketData: { participant: [], stage: [] } });
    setupTxTeam();
    setupSupabaseSuccess();

    const fd = new FormData();
    fd.append("file", new File(["test"], "test.png", { type: "image/png" }));
    const result = await uploadTeamLogo(TEAM_ID, fd);

    expect(result.success).toBe(true);
  });
});
