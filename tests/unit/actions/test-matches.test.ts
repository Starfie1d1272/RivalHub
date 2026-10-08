import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ match: vi.fn(), admin: vi.fn(), correct: vi.fn(), transaction: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/lib/auth/session", () => ({ requireSeasonAdmin: mocks.admin }));
vi.mock("@/lib/action-utils", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/action-utils")>(), getMatchOrThrow: mocks.match, getSeasonOrThrow: async () => ({ slug: "major" }) }));
vi.mock("@/lib/matches/unassociated-result", () => ({ correctUnassociatedResultInTx: mocks.correct, concludeUnassociatedMatchInTx: vi.fn(), supplementUnassociatedResultInTx: vi.fn() }));
vi.mock("@/lib/revalidation", () => ({ revalidateMatchPaths: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { concludeTestMatch } from "@/actions/test-matches";
const matchId = "40000000-0000-4000-8000-000000000001";
const mapId = "40000000-0000-4000-8000-000000000002";
const review = { expectedUpdatedAt: "2026-10-08T00:00:00.000Z", reason: "比分录反", maps: [{ mapId, scoreA: 9, scoreB: 13 }] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.match.mockResolvedValue({ id: matchId, seasonId: "season", testConfig: {}, status: "finished" });
  mocks.admin.mockResolvedValue({ userId: "admin" });
  mocks.transaction.mockImplementation(async callback => callback({ transactionMarker: true }));
});
it("passes validated map corrections to the atomic owner after event authorization", async () => {
  expect(await concludeTestMatch(matchId, { kind: "recorded", scoreA: 0, scoreB: 2 }, review)).toMatchObject({ success: true });
  expect(mocks.admin).toHaveBeenCalledWith("season");
  expect(mocks.correct).toHaveBeenCalledWith({ transactionMarker: true }, expect.objectContaining({ matchId, actorId: "admin", maps: review.maps, reason: review.reason, expectedUpdatedAt: new Date(review.expectedUpdatedAt) }));
});
it("rejects official matches and malformed map input before the result owner", async () => {
  expect(await concludeTestMatch(matchId, { kind: "omitted" }, { ...review, maps: [{ mapId: "foreign-invalid", scoreA: 9, scoreB: 13 }] })).toMatchObject({ success: false });
  mocks.match.mockResolvedValue({ id: matchId, seasonId: "season", testConfig: null, status: "finished" });
  expect(await concludeTestMatch(matchId, { kind: "omitted" }, review)).toMatchObject({ success: false });
  expect(mocks.correct).not.toHaveBeenCalled();
});
