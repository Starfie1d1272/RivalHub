import { beforeEach, describe, expect, it, vi } from "vitest";

const matchMock = vi.hoisted(() => vi.fn());
const authorizationMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
const publicSeasonMock = vi.hoisted(() => vi.fn());
const readViewMock = vi.hoisted(() => vi.fn());
const reconcileRoomMock = vi.hoisted(() => vi.fn());
const seasonMock = vi.hoisted(() => vi.fn());
const submitAppealMock = vi.hoisted(() => vi.fn());
const resolveAppealMock = vi.hoisted(() => vi.fn());
const deliveryState = vi.hoisted(() => ({ pending: true }));
const updateMock = vi.hoisted(() => vi.fn());
const cacheMock = vi.hoisted(() => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

vi.mock("next/cache", () => cacheMock);
vi.mock("@/lib/auth/session", async original => ({
  ...await original<typeof import("@/lib/auth/session")>(),
  getCurrentUserAuthorization: authorizationMock,
  requireAuth: async () => ({ userId: "actor-fixture", email: "fixture@local.test" }),
  requireSeasonAdmin: async () => ({ userId: "actor-fixture", email: "fixture@local.test", role: "super_admin", seasonIds: [] }),
  auditActorId: (actor: { userId: string }) => actor.userId,
}));

vi.mock("@/db/client", () => ({
  db: {
    select: selectMock,
    update: updateMock,
    query: { seasons: { findFirst: seasonMock } },
  },
}));

vi.mock("@/lib/action-utils", async original => ({
  ...await original<typeof import("@/lib/action-utils")>(), getMatchOrThrow: matchMock,
}));

vi.mock("@/lib/data/public-seasons", () => ({
  getPublicOrAuthorizedDraftSeason: publicSeasonMock,
}));

vi.mock("@/lib/matches/veto-room/read-model", () => ({
  getVetoRoomView: readViewMock,
}));

vi.mock("@/lib/matches/veto-room/service", () => ({
  claimVetoRepresentative: vi.fn(),
  pauseVetoRoom: vi.fn(),
  reconcileVetoRoomReceipt: reconcileRoomMock,
  requestVetoStartReceipt: vi.fn(),
  resolveVetoAppeal: resolveAppealMock,
  resumeVetoRoom: vi.fn(),
  rewindVetoRoom: vi.fn(),
  setManualPrivilegedEntry: vi.fn(),
  setVetoRepresentative: vi.fn(),
  submitVetoAppeal: submitAppealMock,
  submitVetoCommandReceipt: vi.fn(),
}));

import { readVetoRoom, reconcileVetoRoomAction, submitVetoRoomAppeal, resolveVetoRoomAppeal } from "@/actions/matches/veto-room";
import { runVetoInteraction } from "@/lib/matches/veto-room/interaction";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";

const matchId = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
    vi.resetAllMocks();
    authorizationMock.mockResolvedValue(null);
    matchMock.mockResolvedValue({ id: "match-1", seasonId: "season-1" });
    deliveryState.pending = true;
    let selectedTable = "";
    const chain = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      leftJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    };
    chain.from.mockImplementation(table => { selectedTable = String(table[Symbol.for("drizzle:Name")]); return chain; });
    chain.innerJoin.mockReturnValue(chain);
    chain.leftJoin.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.limit.mockImplementation(async () => selectedTable === "match_veto_invalidations"
      ? deliveryState.pending ? [{ generation: BigInt(7), slug: "draft-season", seasonId: "season-1", matchStatus: "finished", affectedFacts: ["veto"] }] : []
      : [{ id: "season-1", slug: "draft-season", seasonId: "season-1", entryAId: "entry-a", entryBId: "entry-b", stage: "stage" }]);
    const updateChain = { set: vi.fn(), where: vi.fn(), returning: vi.fn(async () => { deliveryState.pending = false; return [{ matchId }]; }) };
    updateChain.set.mockReturnValue(updateChain); updateChain.where.mockReturnValue(updateChain);
    updateMock.mockReturnValue(updateChain);
    selectMock.mockReturnValue(chain);
    publicSeasonMock.mockResolvedValue(null);
    readViewMock.mockResolvedValue({ seasonSlug: "draft-season", match: { id: "match-1" } });
    reconcileRoomMock.mockResolvedValue({ outcome: "applied", changed: true, committedRevision: 7, affectedFacts: ["veto"] });
    seasonMock.mockResolvedValue({ id: "season-1", slug: "draft-season" });
});

describe("Veto Room action read authorization", () => {
  it("does not return a draft match projection without season authorization", async () => {
    const result = await readVetoRoom("00000000-0000-4000-8000-000000000001");

    expect(result.success).toBe(false);
    expect(readViewMock).not.toHaveBeenCalled();
  });

  it("does not allow an anonymous draft reader to trigger lifecycle reconciliation", async () => {
    const { reconcileVetoRoomAction } = await import("@/actions/matches/veto-room");
    const result = await reconcileVetoRoomAction({ matchId: "00000000-0000-4000-8000-000000000001" });

    expect(result.success).toBe(false);
    expect(reconcileRoomMock).not.toHaveBeenCalled();
    expect(cacheMock.updateTag).not.toHaveBeenCalled();
  });

  it("fails closed if the resolved public season id does not match the match owner", async () => {
    publicSeasonMock.mockResolvedValue({ id: "season-2", slug: "draft-season" });

    const result = await readVetoRoom("00000000-0000-4000-8000-000000000001");

    expect(result.success).toBe(false);
    expect(readViewMock).not.toHaveBeenCalled();
  });

  // Service outcome + real revalidation utility assembly: no-op must preserve
  // cached statistics while returning fresh room data, and writes must expire it.
  it.each(["idempotent", "stale"])("returns the latest room without invalidating caches for %s reconciliation", async outcome => {
    publicSeasonMock.mockResolvedValue({ id: "season-1", slug: "draft-season" });
    deliveryState.pending = false;
    const receipt = { outcome, changed: false, committedRevision: 7, affectedFacts: [] };
    reconcileRoomMock.mockResolvedValue(receipt);
    const room = { seasonSlug: "draft-season", match: { id: matchId }, session: { revision: 7 } };
    readViewMock.mockResolvedValue(room);

    expect(await reconcileVetoRoomAction({ matchId })).toEqual({ success: true, data: { outcome, room, receipt, refreshFailed: false, postCommit: { invalidation: "complete", projection: "complete" } } });
    expect(readViewMock).toHaveBeenCalledWith(matchId, null, "season-1");
    expect(cacheMock.updateTag).not.toHaveBeenCalled();
    expect(cacheMock.revalidateTag).not.toHaveBeenCalled();
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
    expect(seasonMock).not.toHaveBeenCalled();
  });

  it.each(["stale", "idempotent"])("invalidates committed facts independently of %s and before a projection failure", async outcome => {
    publicSeasonMock.mockResolvedValue({ id: "season-1", slug: "draft-season" });
    reconcileRoomMock.mockResolvedValue({ outcome, changed: true, committedRevision: 8, affectedFacts: ["veto"] });
    readViewMock.mockRejectedValueOnce(new Error("projection unavailable"));
    await expect(runVetoInteraction({ operation: "reconcile", matchId }, "route")).resolves.toMatchObject({ room: null, refreshFailed: true, receipt: { changed: true }, postCommit: { invalidation: "complete", projection: "pending" } });
    expect(cacheMock.revalidateTag).toHaveBeenCalledWith(PUBLIC_STATS_TAG, { expire: 0 });
  });

  it("uses route invalidation before projecting a committed BP result", async () => {
    publicSeasonMock.mockResolvedValue({ id: "season-1", slug: "draft-season" });
    readViewMock.mockRejectedValueOnce(new Error("projection unavailable"));
    await expect(runVetoInteraction({ operation: "reconcile", matchId }, "route")).resolves.toMatchObject({ room: null, refreshFailed: true, receipt: { changed: true }, postCommit: { invalidation: "complete", projection: "pending" } });
    expect(cacheMock.revalidateTag).toHaveBeenCalledWith(PUBLIC_STATS_TAG, { expire: 0 });
    expect(cacheMock.updateTag).not.toHaveBeenCalled();
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith(`/draft-season/matches/${matchId}`);
  });

  it("immediately invalidates statistics and match pages after applied reconciliation", async () => {
    publicSeasonMock.mockResolvedValue({ id: "season-1", slug: "draft-season" });

    expect((await reconcileVetoRoomAction({ matchId })).success).toBe(true);
    expect(cacheMock.updateTag).toHaveBeenCalledWith(PUBLIC_STATS_TAG);
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith(`/draft-season/matches/${matchId}`);
    expect(readViewMock).toHaveBeenCalledWith(matchId, null, "season-1");
  });
});

it("preserves a committed appeal submission when its response projection fails", async () => {
  deliveryState.pending = true;
  submitAppealMock.mockResolvedValueOnce(undefined);
  readViewMock.mockRejectedValueOnce(new Error("projection unavailable"));
  const result = await submitVetoRoomAppeal({ matchId, incidentId: matchId, reason: "fixture reason" });
  expect(result).toMatchObject({ success: true, data: { outcome: "applied", room: null, refreshFailed: true } });
  expect(submitAppealMock).toHaveBeenCalledTimes(1);
});

it("preserves a committed rejection when its response projection fails", async () => {
  deliveryState.pending = true;
  resolveAppealMock.mockResolvedValueOnce(undefined);
  readViewMock.mockRejectedValueOnce(new Error("projection unavailable"));
  const result = await resolveVetoRoomAppeal({ matchId, appealId: matchId, resolutionScope: "participant_or_unverified", resolutionNote: "fixture decision" });
  expect(result).toMatchObject({ success: true, data: { outcome: "applied", room: null, refreshFailed: true } });
  expect(resolveAppealMock).toHaveBeenCalledTimes(1);
});

it("retains failed invalidation and retries it on a later no-change reconcile without replaying the command", async () => {
  deliveryState.pending = true;
  publicSeasonMock.mockResolvedValue({ id: "season-1", slug: "draft-season" });
  reconcileRoomMock.mockResolvedValueOnce({ outcome: "applied", changed: true, committedRevision: 8, affectedFacts: ["veto"] });
  let first = true;
  cacheMock.revalidateTag.mockImplementation((tag: string) => { if (tag === PUBLIC_STATS_TAG && first) { first = false; throw new Error("invalidate unavailable"); } });
  const firstResult = await runVetoInteraction({ operation: "reconcile", matchId }, "route");
  expect(firstResult.postCommit.invalidation).toBe("pending");
  expect(deliveryState.pending).toBe(true);
  reconcileRoomMock.mockResolvedValueOnce({ outcome: "idempotent", changed: false, committedRevision: 8, affectedFacts: [] });
  const restored = await runVetoInteraction({ operation: "reconcile", matchId }, "route");
  expect(restored.postCommit.invalidation).toBe("complete");
  expect(deliveryState.pending).toBe(false);
  expect(cacheMock.revalidateTag.mock.calls.filter(call => call[0] === PUBLIC_STATS_TAG)).toHaveLength(2);
});
