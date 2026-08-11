import { beforeEach, describe, expect, it, vi } from "vitest";

// ── 合法 UUID 常量 ─────────────────────────────────────────────────────────────
const SEASON_ID = "11111111-1111-1111-1111-111111111111";
const CAPTAIN_USER_ID = "22222222-2222-2222-2222-222222222222";
const TARGET_USER_ID = "33333333-3333-3333-3333-333333333333";
const CAPTAIN_REG_ID = "44444444-4444-4444-4444-444444444444";
const TARGET_REG_ID = "55555555-5555-5555-5555-555555555555";
const TEAM_ID = "66666666-6666-6666-6666-666666666666";
const TEAM_B_ID = "77777777-7777-7777-7777-777777777777";
const PICK_ID = "88888888-8888-8888-8888-888888888888";
const CLIENT_REQUEST_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// ── hoisted mock refs ──────────────────────────────────────────────────────────
const {
  requireAuthMock,
  txSeasonFindFirstMock,
  txDraftPickFindFirstMock,
  txTeamFindFirstMock,
  txRegFindFirstMock,
  txSelectMock,
  txInsertMock,
  txUpdateMock,
  revalidateSeasonPathsMock,
  insertValuesCalls,
} = vi.hoisted(() => {
  const insertValuesCalls: { table: string; values: unknown }[] = [];
  return {
    requireAuthMock: vi.fn(),
    txSeasonFindFirstMock: vi.fn(),
    txDraftPickFindFirstMock: vi.fn(),
    txTeamFindFirstMock: vi.fn(),
    txRegFindFirstMock: vi.fn(),
    txSelectMock: vi.fn(),
    txInsertMock: vi.fn(),
    txUpdateMock: vi.fn(),
    revalidateSeasonPathsMock: vi.fn(),
    insertValuesCalls,
  };
});

// ── mocks ─────────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth/session", () => ({
  requireAuth: requireAuthMock,
  requireSeasonAdmin: vi.fn(),
  auditActorId: vi.fn((session: { userId?: string }) => session?.userId ?? "system"),
}));

vi.mock("@/lib/revalidation", () => ({
  revalidateSeasonPaths: revalidateSeasonPathsMock,
}));

vi.mock("@/db/schema", () => {
  const mk = (name: string) => ({ __name: name });
  return {
    teams: mk("teams"),
    teamMembers: mk("teamMembers"),
    seasons: mk("seasons"),
    seasonRegistrations: mk("seasonRegistrations"),
    draftState: mk("draftState"),
    draftPicks: mk("draftPicks"),
    auditLogs: mk("auditLogs"),
    users: mk("users"),
  };
});

vi.mock("@/db/client", () => ({
  db: {
    transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(TX)),
  },
}));

const TX = {
  query: {
    seasons: { findFirst: txSeasonFindFirstMock },
    draftPicks: { findFirst: txDraftPickFindFirstMock },
    teams: { findFirst: txTeamFindFirstMock },
    seasonRegistrations: { findFirst: txRegFindFirstMock },
  },
  select: txSelectMock,
  insert: txInsertMock,
  update: txUpdateMock,
};

// ── import after mocks ─────────────────────────────────────────────────────────
import { pickPlayer } from "@/actions/draft/picks";

// ── 公共测试数据 ──────────────────────────────────────────────────────────────
const SEASON = {
  id: SEASON_ID,
  slug: "spring-2026",
  status: "drafting",
  hasDraft: true,
  bracketData: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const DS = {
  id: "ds1",
  seasonId: SEASON_ID,
  currentTeamId: TEAM_ID,
  currentRound: 1,
  roundDeadline: new Date(Date.now() + 60_000),
  isActive: true,
  updatedAt: new Date(),
};

const TEAM = {
  id: TEAM_ID,
  seasonId: SEASON_ID,
  name: "A 队",
  captainRegistrationId: CAPTAIN_REG_ID,
  captainUserId: CAPTAIN_USER_ID,
  draftOrder: 2,
  logoUrl: null,
  createdAt: new Date(),
};

const CAPTAIN_REG = {
  id: CAPTAIN_REG_ID,
  userId: CAPTAIN_USER_ID,
  seasonId: SEASON_ID,
  status: "approved",
};

const TARGET_REG = {
  id: TARGET_REG_ID,
  userId: TARGET_USER_ID,
  seasonId: SEASON_ID,
  status: "approved",
  primaryPosition: "opener",
};

const SEASON_TEAMS = [
  { id: TEAM_B_ID, draftOrder: 1 },
  { id: TEAM_ID, draftOrder: 2 },
];

// tx.select 按 from 的表分派返回链
function setupTxSelect() {
  txSelectMock.mockImplementation(() => ({
    from: vi.fn((table: { __name?: string }) => {
      const name = table.__name ?? "?";
      if (name === "draftState") {
        return { where: vi.fn().mockReturnValue({ for: vi.fn().mockResolvedValue([DS]) }) };
      }
      if (name === "teamMembers") {
        // 位置统计：无同位置冲突
        return { innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
      }
      if (name === "draftPicks") {
        // pickNumber 计数
        return { where: vi.fn().mockResolvedValue([{ count: 0 }]) };
      }
      if (name === "teams") {
        // 选秀顺序（getNextTeamId）
        return { where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(SEASON_TEAMS) }) };
      }
      return { where: vi.fn().mockResolvedValue([]) };
    }),
  }));
}

function setupTxInsert() {
  txInsertMock.mockImplementation((table: { __name?: string }) => {
    const name = table.__name ?? "?";
    if (name === "draftPicks") {
      return {
        values: vi.fn((values: unknown) => {
          insertValuesCalls.push({ table: name, values });
          return { returning: vi.fn().mockResolvedValue([{ id: PICK_ID }]) };
        }),
      };
    }
    return {
      values: vi.fn((values: unknown) => {
        insertValuesCalls.push({ table: name, values });
        return Promise.resolve();
      }),
    };
  });
}

function setupTxUpdate() {
  txUpdateMock.mockImplementation(() => ({
    set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  insertValuesCalls.length = 0;
  requireAuthMock.mockResolvedValue({ userId: CAPTAIN_USER_ID, email: "captain@test.com" });
  txSeasonFindFirstMock.mockResolvedValue(SEASON);
  txDraftPickFindFirstMock.mockResolvedValue(null);
  txTeamFindFirstMock.mockResolvedValue(TEAM);
  txRegFindFirstMock.mockResolvedValueOnce(CAPTAIN_REG).mockResolvedValueOnce(TARGET_REG);
  setupTxSelect();
  setupTxInsert();
  setupTxUpdate();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("pickPlayer() — Rivals draft pick dual-write", () => {
  it("teamMember insert writes registrationId + userId + seasonId", async () => {
    const result = await pickPlayer({
      seasonId: SEASON_ID,
      teamId: TEAM_ID,
      registrationId: TARGET_REG_ID,
      clientRequestId: CLIENT_REQUEST_ID,
    });

    expect(result.success).toBe(true);

    const memberInserts = insertValuesCalls.filter((c) => c.table === "teamMembers");
    expect(memberInserts).toHaveLength(1);
    const values = memberInserts[0].values as Record<string, string>;
    expect(values.registrationId).toBe(TARGET_REG_ID);
    expect(values.userId).toBe(TARGET_USER_ID);
    expect(values.seasonId).toBe(SEASON_ID);
  });

  it("draft regression: draftPick insert keeps registrationId provenance", async () => {
    const result = await pickPlayer({
      seasonId: SEASON_ID,
      teamId: TEAM_ID,
      registrationId: TARGET_REG_ID,
      clientRequestId: CLIENT_REQUEST_ID,
    });

    expect(result.success).toBe(true);

    const pickInserts = insertValuesCalls.filter((c) => c.table === "draftPicks");
    expect(pickInserts).toHaveLength(1);
    const values = pickInserts[0].values as Record<string, string>;
    expect(values.registrationId).toBe(TARGET_REG_ID);
    expect(values.seasonId).toBe(SEASON_ID);
    expect(values.teamId).toBe(TEAM_ID);
  });
});
