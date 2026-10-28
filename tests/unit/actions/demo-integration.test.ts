import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ importRow: vi.fn(), identity: vi.fn(), season: vi.fn(), transaction: vi.fn(), authorize: vi.fn(), confirm: vi.fn(), reject: vi.fn(), retire: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { query: { matchDemoImports: { findFirst: mocks.importRow }, userGameplaySteamIds: { findFirst: mocks.identity }, seasons: { findFirst: mocks.season } }, transaction: mocks.transaction } }));
vi.mock("@/lib/auth/session", () => ({ requireSeasonAdmin: mocks.authorize, auditActorId: vi.fn() }));
vi.mock("@/lib/revalidation", () => ({ revalidateMatchPaths: vi.fn() }));
vi.mock("@/lib/demo-integration/review", () => ({ confirmStoredDemoParticipantIdentityInTx: mocks.confirm, rejectStoredDemoImportInTx: mocks.reject, retireSeasonGameplaySteamIdentityInTx: mocks.retire }));
vi.mock("@/lib/demo-integration/revalidation", () => ({ revalidateStoredDemoImportInTx: vi.fn(), revalidateSeasonNeedsAttentionImports: vi.fn(), revalidateNeedsAttentionImportsForSteam64: vi.fn() }));

import { confirmStoredDemoParticipantIdentity, rejectStoredDemoImport, retireGameplaySteamIdentity } from "@/actions/demo-integration";

const IMPORT_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const IDENTITY_ID = "33333333-3333-4333-8333-333333333333";
const MATCH_ID = "44444444-4444-4444-8444-444444444444";
const OWN_SEASON_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_SEASON_ID = "66666666-6666-4666-8666-666666666666";
const STEAM64 = "76561198000000001";
const importRow = (seasonId = OWN_SEASON_ID) => ({ id: IMPORT_ID, seasonId, matchId: MATCH_ID });
const sourceImport = importRow;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.importRow.mockResolvedValue(importRow());
  mocks.season.mockResolvedValue({ id: OWN_SEASON_ID, slug: "own-season" });
});

describe("Demo identity action authorization", () => {

  it("rejects a caller without the import's season grant before mutation", async () => {
    mocks.authorize.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "权限不足"));

    const result = await confirmStoredDemoParticipantIdentity({
      importId: IMPORT_ID,
      eventRosterMemberId: MEMBER_ID,
      observedSteam64: STEAM64,
    });

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.FORBIDDEN } });
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("scopes a guessed import id to the season loaded from that import", async () => {
    mocks.importRow.mockResolvedValue(importRow(OTHER_SEASON_ID));
    mocks.authorize.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "权限不足"));

    const result = await rejectStoredDemoImport({ importId: IMPORT_ID });

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.FORBIDDEN } });
    expect(mocks.authorize).toHaveBeenCalledWith(OTHER_SEASON_ID);
    expect(mocks.reject).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("uses the source import season for retire and blocks another-season admins", async () => {
    mocks.identity.mockResolvedValue({
      id: IDENTITY_ID,
      sourceImportId: IMPORT_ID,
      provenance: "admin_confirmed_alternate",
      steam64: STEAM64,
    });
    mocks.importRow.mockResolvedValue(sourceImport(OTHER_SEASON_ID));
    mocks.season.mockResolvedValue({ id: OTHER_SEASON_ID, slug: "other-season" });
    mocks.authorize.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "权限不足"));

    const result = await retireGameplaySteamIdentity({ identityId: IDENTITY_ID, reason: "错误确认" });

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.FORBIDDEN } });
    expect(mocks.authorize).toHaveBeenCalledWith(OTHER_SEASON_ID);
    expect(mocks.retire).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

});
