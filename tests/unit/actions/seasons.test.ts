import { describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), find: vi.fn(), transaction: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), remove: vi.fn(), execute: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSuperAdmin: mocks.authorize, auditActorId: vi.fn(), requireAuth: vi.fn(), requireAdmin: vi.fn(), requireSeasonAdmin: vi.fn(), getUserSession: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { query: { seasons: { findFirst: mocks.find } }, transaction: mocks.transaction, select: mocks.select, insert: mocks.insert, update: mocks.update, delete: mocks.remove, execute: mocks.execute } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate, updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { createSeason, updateSeason, openSeasonRegistration, publishSeason, deleteSeason, revertSeasonToDraft, revertSeasonToRegistration, forceFinishSeason, archiveSeason } from "@/actions/seasons";

const SEASON_ID = "00000000-0000-0000-0000-000000000001";

const VALID_INPUT = {
  name: "Test Season 2026",
  slug: "test-2026",
  kind: "联赛",
  registrationMode: "solo" as const,
  hasCaptainVoting: true,
  hasDraft: true,
  hasCommunityAwards: true,
  minTeamSize: 4,
  maxTeamSize: 8,
  starterCount: 5,
  positions: ["opener", "closer", "anchor"],
  stagePlan: [
    {
      key: "swiss-1",
      name: "瑞士轮第1轮",
      type: "swiss" as const,
      teamCount: 32,
      advanceTiers: [] as { placement: string; count: number; targetRound?: string }[],
    },
  ],
  registrationConfig: {
    allowedPlayerTypes: ["enrolled"] as const,
    rankThreshold: { currentMin: null as string | null, peakMin: null as string | null },
    maxPerPosition: 3,
    screenshotCount: 2,
    maxTotal: 200,
    mapPool: ["de_dust2", "de_mirage", "de_inferno"],
  },
  registrationOpensAt: null as string | null,
  registrationClosesAt: null as string | null,
  rosterChangeClosesAt: null as string | null,
  endAt: null as string | null,
  themeColor: null as string | null,
};

describe("season mutation authorization boundary", () => {
  it.each([
    ["create", () => createSeason(VALID_INPUT)],
    ["update", () => updateSeason({ ...VALID_INPUT, id: SEASON_ID })],
    ["publish", () => publishSeason(SEASON_ID)],
    ["delete", () => deleteSeason(SEASON_ID)],
    ["open registration", () => openSeasonRegistration(SEASON_ID)],
    ["revert draft", () => revertSeasonToDraft(SEASON_ID)],
    ["revert registration", () => revertSeasonToRegistration(SEASON_ID)],
    ["finish", () => forceFinishSeason(SEASON_ID)],
    ["archive", () => archiveSeason(SEASON_ID)],
  ] as const)("rejects %s before reads, writes, audit or revalidation", async (_operation, mutate) => {
    vi.clearAllMocks();
    mocks.authorize.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "forbidden"));

    await expect(mutate()).resolves.toMatchObject({ success: false, error: { code: ErrorCode.FORBIDDEN } });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
