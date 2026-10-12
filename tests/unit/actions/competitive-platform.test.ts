import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockUserSession, resetAuditTracking } from "tests/helpers";

// ── hoisted mock 工厂 ────────────────────────────────────────────────────────

const {
  requireSuperAdminMock,
  requireAuthMock,
  dbTransactionMock,
  dbSelectMock,
  dbInsertMock,
  dbUpdateMock,
  dbDeleteMock,
  dbExecuteMock,
  insertValuesCalls,
  updateSetCalls,
  selectResults,
  executeResults,
  revalidatePathMock,
  queryFindFirst,
} = vi.hoisted(() => {
  const insertValuesCalls: unknown[] = [];
  const updateSetCalls: unknown[] = [];
  const selectResults: unknown[] = [];
  const executeResults: Array<Array<Record<string, unknown>>> = [];
  const queryFindFirst = {
    competitivePlatforms: vi.fn(),
    competitivePlatformSeasons: vi.fn(),
    competitivePlatformRanks: vi.fn(),
    competitiveRankFacts: vi.fn(),
  };

  const dbSelectMock = vi.fn(() => {
    const builder: Record<string, unknown> = {};
    builder.from = vi.fn(() => builder);
    builder.where = vi.fn(() => builder);
    builder.orderBy = vi.fn(() => builder);
    builder.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []));
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(selectResults.shift() ?? []).then(resolve);
    return builder;
  });

  const dbInsertMock = vi.fn(() => ({
    values: vi.fn((vals: unknown) => {
      insertValuesCalls.push(vals);
      return { returning: vi.fn().mockResolvedValue([{ id: "row-1" }]), then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(undefined)) };
    }),
  }));

  const dbUpdateMock = vi.fn(() => ({
    set: vi.fn((vals: unknown) => {
      updateSetCalls.push(vals);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));

  const dbDeleteMock = vi.fn(() => ({
    where: vi.fn().mockResolvedValue(undefined),
  }));

  const dbExecuteMock = vi.fn(() => ({
    rows: executeResults.shift() ?? [],
  }));

  return {
    requireSuperAdminMock: vi.fn(),
    requireAuthMock: vi.fn(),
    dbTransactionMock: vi.fn(),
    dbSelectMock,
    dbInsertMock,
    dbUpdateMock,
    dbDeleteMock,
    dbExecuteMock,
    insertValuesCalls,
    updateSetCalls,
    selectResults,
    executeResults,
    revalidatePathMock: vi.fn(),
    queryFindFirst,
  };
});

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...original,
    requireSuperAdmin: requireSuperAdminMock,
    requireAuth: requireAuthMock,
    auditActorId: vi.fn((session: { userId: string }) => session.userId),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
  updateTag: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    transaction: dbTransactionMock,
    select: dbSelectMock,
    insert: dbInsertMock,
    update: dbUpdateMock,
    delete: dbDeleteMock,
    execute: dbExecuteMock,
    query: Object.fromEntries(Object.entries(queryFindFirst).map(([key, fn]) => [key, { findFirst: fn }])),
  },
}));

import { updateCompetitivePlatform } from "@/actions/competitive-platform";

function makeTx() {
  return {
    query: Object.fromEntries(Object.entries(queryFindFirst).map(([key, fn]) => [key, { findFirst: fn }])),
    select: dbSelectMock,
    insert: dbInsertMock,
    update: dbUpdateMock,
    delete: dbDeleteMock,
    execute: dbExecuteMock,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuditTracking(insertValuesCalls, updateSetCalls);
  selectResults.length = 0;
  executeResults.length = 0;
  requireSuperAdminMock.mockResolvedValue(mockUserSession({ userId: "admin-1", role: "super_admin" }));
  dbTransactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx()));
});

// ── 权限 ─────────────────────────────────────────────────────────────────────

describe("catalog action permissions", () => {
  it("rejects non-super-admin operators before touching the database", async () => {
    requireSuperAdminMock.mockRejectedValue(new Error("权限不足"));
    const result = await updateCompetitivePlatform({ key: "perfect_world", displayName: "新名称", ratingLabel: "Rating Pro" });
    expect(result.success).toBe(false);
    expect(dbTransactionMock).not.toHaveBeenCalled();
    expect(insertValuesCalls).toHaveLength(0);
  });
});

// ── Platform identity ───────────────────────────────────────────────────────

// ── Season chronology ───────────────────────────────────────────────────────

// ── Rank ladder ─────────────────────────────────────────────────────────────

// ── User profile validation ─────────────────────────────────────────────────
