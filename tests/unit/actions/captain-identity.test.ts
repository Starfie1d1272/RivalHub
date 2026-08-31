import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

// ── 合法 UUID 常量 ─────────────────────────────────────────────────────────────
const SEASON_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID_1 = "22222222-2222-2222-2222-222222222222";
const USER_ID_2 = "33333333-3333-3333-3333-333333333333";
const TEAM_A_ID = "66666666-6666-6666-6666-666666666666";
const TEAM_B_ID = "77777777-7777-7777-7777-777777777777";

// ── hoisted mock refs ──────────────────────────────────────────────────────────
const {
  requireSeasonAdminMock,
  txSeasonFindFirstMock,
  txSelectMock,
  txInsertMock,
  txUpdateMock,
  revalidateSeasonPathsMock,
  // 外部 db.select（getEntryIdForRepresentative）
  dbSelectMock,
  // 捕获 insert values
  insertValuesCalls,
} = vi.hoisted(() => {
  const insertValuesCalls: { table: string; values: unknown }[] = [];
  return {
    requireSeasonAdminMock: vi.fn(),
    txSeasonFindFirstMock: vi.fn(),
    txSelectMock: vi.fn(),
    txInsertMock: vi.fn(),
    txUpdateMock: vi.fn(),
    revalidateSeasonPathsMock: vi.fn(),
    dbSelectMock: vi.fn(),
    insertValuesCalls,
  };
});

// ── mocks ─────────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn(),
  requireSeasonAdmin: requireSeasonAdminMock,
  auditActorId: vi.fn((admin: { email?: string; userId?: string }) => admin?.email ?? admin?.userId ?? "system"),
}));

vi.mock("@/lib/revalidation", () => ({
  revalidateSeasonPaths: revalidateSeasonPathsMock,
}));

vi.mock("@/db/schema", () => {
  // 列对象带 name 属性，便于对 where predicate 做 SQL chunk 检查
  const col = (name: string) => ({ name });
  const mk = (name: string, cols: Record<string, unknown> = {}) => ({ __name: name, ...cols });
  return {
    competitionEntries: mk("competitionEntries", { id: col("id"), competitionId: col("competition_id"), representativeUserId: col("representative_user_id") }),
    competitionEntryParticipants: mk("competitionEntryParticipants", { id: col("id") }),
    competitionEntryRepresentativeChanges: mk("competitionEntryRepresentativeChanges", { id: col("id") }),
    competitionEntryRosterRevisions: mk("competitionEntryRosterRevisions", { id: col("id") }),
    competitionEntryRosterMembers: mk("competitionEntryRosterMembers", { id: col("id") }),
    eventRosters: mk("eventRosters", { id: col("id") }),
    eventRosterMembers: mk("eventRosterMembers", { id: col("id") }),
    seasons: mk("seasons", {}),
    seasonRegistrations: mk("seasonRegistrations", {}),
    captainVotes: mk("captainVotes", {}),
    auditLogs: mk("auditLogs", {}),
    users: mk("users", {}),
  };
});

vi.mock("@/lib/action-utils", () => ({
  getMatchOrThrow: vi.fn(),
  isPgUniqueViolation: vi.fn(() => false),
  failValidation: vi.fn(),
  actionError: vi.fn((_scope: string, e: unknown) => ({
    success: false,
    error: { code: ErrorCode.INTERNAL_ERROR, message: String(e) },
  })),
}));

vi.mock("@/db/client", () => ({
  db: {
    transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(TX)),
    select: dbSelectMock,
  },
}));

const TX = {
  query: {
    seasons: { findFirst: txSeasonFindFirstMock },
  },
  select: txSelectMock,
  insert: txInsertMock,
  update: txUpdateMock,
};

// ── import after mocks ─────────────────────────────────────────────────────────
import { confirmCaptains } from "@/actions/captains";
import { getEntryIdForRepresentative } from "@/actions/matches/_shared";

// ── 公共测试数据 ──────────────────────────────────────────────────────────────
const SEASON = {
  id: SEASON_ID,
  slug: "spring-2026",
  status: "voting",
  hasCaptainVoting: true,
  hasDraft: true,
  bracketData: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// CAPTAIN_TEAM_COUNT = 8，必须提供 8 名候选人
const CANDIDATES = Array.from({ length: 8 }, (_, i) => ({
  registrationId: `10000000-0000-4000-8000-00000000000${i}`,
  userId: `20000000-0000-4000-8000-00000000000${i}`,
  peakRating: 2.5 - i * 0.1,
  createdAt: new Date(`2026-01-0${i + 1}`),
  steamName: `c${i + 1}`,
  displayName: null,
  perfectName: `队长${i + 1}`,
  email: `c${i + 1}@test.com`,
}));

const VOTE_ROWS = CANDIDATES.map((c) => ({ candidateRegistrationId: c.registrationId }));

// tx.select 按 from 的表分派返回链
function setupTxSelect() {
  txSelectMock.mockImplementation(() => ({
    from: vi.fn((table: { __name?: string }) => {
      const name = table.__name ?? "?";
      if (name === "competitionEntries") {
        // existingTeamCount
        return { where: vi.fn().mockResolvedValue([{ count: 0 }]) };
      }
      if (name === "captainVotes") {
        return {
          // totalVotes（带 innerJoin）
          innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ count: 3 }]) }),
          // voteRows（无 innerJoin）
          where: vi.fn().mockResolvedValue(VOTE_ROWS),
        };
      }
      if (name === "seasonRegistrations") {
        // candidates
        return { innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(CANDIDATES) }) };
      }
      return { where: vi.fn().mockResolvedValue([]) };
    }),
  }));
}

function setupTxInsert() {
  let entrySeq = 0;
  txInsertMock.mockImplementation((table: { __name?: string }) => {
    const name = table.__name ?? "?";
    if (name === "competitionEntries") {
      return {
        values: vi.fn((values: unknown) => {
          insertValuesCalls.push({ table: name, values });
          entrySeq += 1;
          return { returning: vi.fn().mockResolvedValue([{ id: entrySeq === 1 ? TEAM_A_ID : TEAM_B_ID }]) };
        }),
      };
    }
    if (["competitionEntryParticipants", "competitionEntryRosterRevisions", "eventRosters"].includes(name)) {
      return {
        values: vi.fn((values: unknown) => {
          insertValuesCalls.push({ table: name, values });
          return { returning: vi.fn().mockResolvedValue([{ id: `${name}-${insertValuesCalls.length}` }]) };
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
});

// ─────────────────────────────────────────────────────────────────────────────
describe("confirmCaptains() — Rivals event-native Entry formation", () => {
  beforeEach(() => {
    requireSeasonAdminMock.mockResolvedValue({ email: "admin@test.com" });
    txSeasonFindFirstMock.mockResolvedValue(SEASON);
    setupTxSelect();
    setupTxInsert();
    setupTxUpdate();
  });

  it("writes source registration provenance and representative on Entry", async () => {
    const result = await confirmCaptains({ seasonId: SEASON_ID });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const entryInserts = insertValuesCalls.filter((c) => c.table === "competitionEntries");
    expect(entryInserts).toHaveLength(8);
    for (const t of entryInserts) {
      const values = t.values as Record<string, unknown>;
      expect(values.sourceRegistrationId).toBeTypeOf("string");
      expect(values.representativeUserId).toBeTypeOf("string");
      expect(values.currentRosterRevisionId).toBeTypeOf("string");
      expect(values.source).toBe("event_native");
    }
    const byReg = new Map(CANDIDATES.map((c) => [c.registrationId, c.userId]));
    for (const t of entryInserts) {
      const values = t.values as Record<string, string>;
      expect(byReg.get(values.sourceRegistrationId)).toBe(values.representativeUserId);
    }
    expect(insertValuesCalls.filter((c) => c.table === "competitionEntryRepresentativeChanges")).toHaveLength(8);
  });

  it("keeps participant commitment separate from event roster membership", async () => {
    const result = await confirmCaptains({ seasonId: SEASON_ID });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(insertValuesCalls.filter((c) => c.table === "competitionEntryParticipants")).toHaveLength(8);
    expect(insertValuesCalls.filter((c) => c.table === "competitionEntryRosterMembers")).toHaveLength(8);
    expect(insertValuesCalls.filter((c) => c.table === "eventRosterMembers")).toHaveLength(8);
  });

  it("keeps event formation order provenance (1-based)", async () => {
    const result = await confirmCaptains({ seasonId: SEASON_ID });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const entryInserts = insertValuesCalls.filter((c) => c.table === "competitionEntries");
    const orders = entryInserts.map((t) => (t.values as Record<string, number>).formationOrder).sort();
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("getEntryIdForRepresentative() — canonical entrant authorization", () => {
  const match = {
    id: "m1",
    seasonId: SEASON_ID,
    entryAId: TEAM_A_ID,
    entryBId: TEAM_B_ID,
    status: "scheduled",
  } as unknown as Parameters<typeof getEntryIdForRepresentative>[1];

  let lastWhere: unknown;

  function mockTeamRows(rows: { id: string }[], capture = false) {
    dbSelectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn((cond: unknown) => {
          if (capture) lastWhere = cond;
          return Promise.resolve(rows);
        }),
      }),
    });
  }

  /** 递归检查 drizzle SQL chunk 树中是否包含指定列名 */
  function sqlContains(chunk: unknown, needle: string): boolean {
    if (!chunk || typeof chunk !== "object") return false;
    if (Array.isArray(chunk)) return chunk.some((c) => sqlContains(c, needle));
    const obj = chunk as { name?: unknown; queryChunks?: unknown };
    if (typeof obj.name === "string" && obj.name === needle) return true;
    if (Array.isArray(obj.queryChunks)) return sqlContains(obj.queryChunks, needle);
    return false;
  }

  beforeEach(() => {
    lastWhere = undefined;
  });

  it("representative match + match participant + same competition → allowed", async () => {
    mockTeamRows([{ id: TEAM_A_ID }], true);
    const teamId = await getEntryIdForRepresentative(USER_ID_1, match);
    expect(teamId).toBe(TEAM_A_ID);
    // query predicate 必须包含 season scope（defense-in-depth）
    expect(sqlContains(lastWhere, "competition_id")).toBe(true);
    expect(sqlContains(lastWhere, "representative_user_id")).toBe(true);
    expect(sqlContains(lastWhere, "id")).toBe(true);
  });

  it("captain of teamB → returns teamB id", async () => {
    mockTeamRows([{ id: TEAM_B_ID }], true);
    const teamId = await getEntryIdForRepresentative(USER_ID_2, match);
    expect(teamId).toBe(TEAM_B_ID);
    expect(sqlContains(lastWhere, "competition_id")).toBe(true);
  });

  it("same captainUserId but team season != match season → denied (no matching row)", async () => {
    // 谓词含 season scope：跨赛季队伍不会命中（mock 返回空行即等价于被谓词排除）
    mockTeamRows([], true);
    const teamId = await getEntryIdForRepresentative(USER_ID_1, match);
    expect(teamId).toBeNull();
    expect(sqlContains(lastWhere, "competition_id")).toBe(true);
  });

  it("non-captain → denied (null)", async () => {
    mockTeamRows([]);
    const teamId = await getEntryIdForRepresentative("99999999-9999-9999-9999-999999999999", match);
    expect(teamId).toBeNull();
  });
});
