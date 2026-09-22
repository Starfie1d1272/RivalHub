import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const {
  matchDemoImportsFindFirstMock,
  matchesFindFirstMock,
  seasonsFindFirstMock,
  userGameplaySteamIdsFindFirstMock,
  transactionMock,
  requireSeasonAdminMock,
  auditActorIdMock,
  confirmMock,
  rejectMock,
  retireMock,
  revalidateMatchPathsMock,
} = vi.hoisted(() => ({
  matchDemoImportsFindFirstMock: vi.fn(),
  matchesFindFirstMock: vi.fn(),
  seasonsFindFirstMock: vi.fn(),
  userGameplaySteamIdsFindFirstMock: vi.fn(),
  transactionMock: vi.fn(),
  requireSeasonAdminMock: vi.fn(),
  auditActorIdMock: vi.fn(),
  confirmMock: vi.fn(),
  rejectMock: vi.fn(),
  retireMock: vi.fn(),
  revalidateMatchPathsMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      matchDemoImports: { findFirst: matchDemoImportsFindFirstMock },
      matches: { findFirst: matchesFindFirstMock },
      seasons: { findFirst: seasonsFindFirstMock },
      userGameplaySteamIds: { findFirst: userGameplaySteamIdsFindFirstMock },
    },
    transaction: transactionMock,
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireSeasonAdmin: requireSeasonAdminMock,
  auditActorId: auditActorIdMock,
}));

vi.mock("@/lib/revalidation", () => ({ revalidateMatchPaths: revalidateMatchPathsMock }));

vi.mock("@/lib/demo-integration/review", () => ({
  confirmStoredDemoParticipantIdentityInTx: confirmMock,
  rejectStoredDemoImportInTx: rejectMock,
  retireSeasonGameplaySteamIdentityInTx: retireMock,
}));

import {
  confirmStoredDemoParticipantIdentity,
  rejectStoredDemoImport,
  retireGameplaySteamIdentity,
} from "@/actions/demo-integration";

const IMPORT_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const IDENTITY_ID = "33333333-3333-4333-8333-333333333333";
const MATCH_ID = "44444444-4444-4444-8444-444444444444";
const OWN_SEASON_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_SEASON_ID = "66666666-6666-4666-8666-666666666666";
const STEAM64 = "76561198000000001";
const ACTOR_ID = "77777777-7777-4777-8777-777777777777";

const importRow = (seasonId = OWN_SEASON_ID) => ({
  id: IMPORT_ID,
  seasonId,
  matchId: MATCH_ID,
});

const sourceImport = (seasonId = OWN_SEASON_ID) => ({
  id: IMPORT_ID,
  seasonId,
  matchId: MATCH_ID,
});

beforeEach(() => {
  vi.clearAllMocks();
  matchDemoImportsFindFirstMock.mockResolvedValue(importRow());
  matchesFindFirstMock.mockResolvedValue({ id: MATCH_ID });
  seasonsFindFirstMock.mockResolvedValue({ id: OWN_SEASON_ID, slug: "own-season" });
  userGameplaySteamIdsFindFirstMock.mockResolvedValue({
    id: IDENTITY_ID,
    sourceImportId: IMPORT_ID,
    provenance: "admin_confirmed_alternate",
  });
  requireSeasonAdminMock.mockResolvedValue({ userId: ACTOR_ID });
  auditActorIdMock.mockReturnValue(ACTOR_ID);
  transactionMock.mockImplementation((callback: (tx: unknown) => unknown) => callback({}));
  confirmMock.mockResolvedValue({ status: "confirmed", importId: IMPORT_ID, issues: [], alreadyConfirmed: false, aliasCreated: true });
  rejectMock.mockResolvedValue({ alreadyRejected: false });
  retireMock.mockResolvedValue({ retired: true });
});

describe("Demo identity action authorization", () => {
  it("allows a season admin to confirm an import in the admin's own season", async () => {
    const result = await confirmStoredDemoParticipantIdentity({
      importId: IMPORT_ID,
      eventRosterMemberId: MEMBER_ID,
      observedSteam64: STEAM64,
    });

    expect(result).toMatchObject({ success: true });
    expect(requireSeasonAdminMock).toHaveBeenCalledWith(OWN_SEASON_ID);
    expect(confirmMock).toHaveBeenCalledWith(expect.anything(), {
      importId: IMPORT_ID,
      eventRosterMemberId: MEMBER_ID,
      observedSteam64: STEAM64,
      actorId: ACTOR_ID,
    });
  });

  it.each([
    ["ordinary user", new AppError(ErrorCode.FORBIDDEN, "权限不足")],
    ["an admin of another season", new AppError(ErrorCode.FORBIDDEN, "权限不足")],
  ] as const)("rejects %s before the confirm owner can mutate", async (_label, error) => {
    requireSeasonAdminMock.mockRejectedValue(error);

    const result = await confirmStoredDemoParticipantIdentity({
      importId: IMPORT_ID,
      eventRosterMemberId: MEMBER_ID,
      observedSteam64: STEAM64,
    });

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.FORBIDDEN } });
    expect(confirmMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("scopes a guessed import id to the season loaded from that import", async () => {
    matchDemoImportsFindFirstMock.mockResolvedValue(importRow(OTHER_SEASON_ID));
    requireSeasonAdminMock.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "权限不足"));

    const result = await rejectStoredDemoImport({ importId: IMPORT_ID });

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.FORBIDDEN } });
    expect(requireSeasonAdminMock).toHaveBeenCalledWith(OTHER_SEASON_ID);
    expect(rejectMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("allows reject only after the own-season admin check", async () => {
    const result = await rejectStoredDemoImport({ importId: IMPORT_ID });

    expect(result).toMatchObject({ success: true, data: { alreadyRejected: false } });
    expect(requireSeasonAdminMock).toHaveBeenCalledWith(OWN_SEASON_ID);
    expect(rejectMock).toHaveBeenCalledWith(expect.anything(), { importId: IMPORT_ID, actorId: ACTOR_ID });
  });

  it("uses the source import season for retire and blocks another-season admins", async () => {
    userGameplaySteamIdsFindFirstMock.mockResolvedValue({
      id: IDENTITY_ID,
      sourceImportId: IMPORT_ID,
      provenance: "admin_confirmed_alternate",
    });
    matchDemoImportsFindFirstMock.mockResolvedValue(sourceImport(OTHER_SEASON_ID));
    seasonsFindFirstMock.mockResolvedValue({ id: OTHER_SEASON_ID, slug: "other-season" });
    requireSeasonAdminMock.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "权限不足"));

    const result = await retireGameplaySteamIdentity({ identityId: IDENTITY_ID, reason: "错误确认" });

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.FORBIDDEN } });
    expect(requireSeasonAdminMock).toHaveBeenCalledWith(OTHER_SEASON_ID);
    expect(retireMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("allows retire only for an admin-confirmed identity in the own season", async () => {
    const result = await retireGameplaySteamIdentity({ identityId: IDENTITY_ID, reason: "错误确认" });

    expect(result).toMatchObject({ success: true, data: { retired: true } });
    expect(requireSeasonAdminMock).toHaveBeenCalledWith(OWN_SEASON_ID);
    expect(retireMock).toHaveBeenCalledWith(expect.anything(), {
      identityId: IDENTITY_ID,
      reason: "错误确认",
      seasonId: OWN_SEASON_ID,
      actorId: ACTOR_ID,
    });
  });
});
