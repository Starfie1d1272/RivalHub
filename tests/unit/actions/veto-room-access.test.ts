import { beforeEach, describe, expect, it, vi } from "vitest";

const matchMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
const publicSeasonMock = vi.hoisted(() => vi.fn());
const readViewMock = vi.hoisted(() => vi.fn());
const reconcileRoomMock = vi.hoisted(() => vi.fn());
const seasonMock = vi.hoisted(() => vi.fn());
const cacheMock = vi.hoisted(() => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

vi.mock("next/cache", () => cacheMock);

vi.mock("@/db/client", () => ({
  db: {
    select: selectMock,
    query: { seasons: { findFirst: seasonMock } },
  },
}));

vi.mock("@/lib/action-utils", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/action-utils")>(),
  getMatchOrThrow: matchMock,
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
  reconcileVetoRoom: reconcileRoomMock,
  requestVetoStart: vi.fn(),
  resolveVetoAppeal: vi.fn(),
  resumeVetoRoom: vi.fn(),
  rewindVetoRoom: vi.fn(),
  setManualPrivilegedEntry: vi.fn(),
  setVetoRepresentative: vi.fn(),
  submitVetoAppeal: vi.fn(),
  submitVetoCommand: vi.fn(),
}));

import { readVetoRoom, reconcileVetoRoomAction } from "@/actions/matches/veto-room";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";

const matchId = "00000000-0000-4000-8000-000000000001";

describe("Veto Room action read authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matchMock.mockResolvedValue({ id: "match-1", seasonId: "season-1" });
    const chain = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    };
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.limit.mockResolvedValue([{ id: "season-1", slug: "draft-season" }]);
    selectMock.mockReturnValue(chain);
    publicSeasonMock.mockResolvedValue(null);
    readViewMock.mockResolvedValue({ match: { id: "match-1" } });
    reconcileRoomMock.mockResolvedValue("applied");
    seasonMock.mockResolvedValue({ id: "season-1", slug: "draft-season" });
  });

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
    reconcileRoomMock.mockResolvedValue(outcome);
    const room = { match: { id: matchId }, session: { revision: 7 } };
    readViewMock.mockResolvedValue(room);

    expect(await reconcileVetoRoomAction({ matchId })).toEqual({ success: true, data: { outcome, room } });
    expect(readViewMock).toHaveBeenCalledWith(matchId);
    expect(cacheMock.updateTag).not.toHaveBeenCalled();
    expect(cacheMock.revalidateTag).not.toHaveBeenCalled();
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
    expect(seasonMock).not.toHaveBeenCalled();
  });

  it("immediately invalidates statistics and match pages after applied reconciliation", async () => {
    publicSeasonMock.mockResolvedValue({ id: "season-1", slug: "draft-season" });

    expect((await reconcileVetoRoomAction({ matchId })).success).toBe(true);
    expect(cacheMock.updateTag).toHaveBeenCalledWith(PUBLIC_STATS_TAG);
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith(`/draft-season/matches/${matchId}`);
    expect(readViewMock).toHaveBeenCalledWith(matchId);
  });
});
