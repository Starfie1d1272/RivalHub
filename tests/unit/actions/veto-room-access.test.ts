import { beforeEach, describe, expect, it, vi } from "vitest";

const matchMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
const publicSeasonMock = vi.hoisted(() => vi.fn());
const readViewMock = vi.hoisted(() => vi.fn());
const reconcileRoomMock = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({
  db: {
    select: selectMock,
    query: { seasons: { findFirst: vi.fn() } },
  },
}));

vi.mock("@/lib/action-utils", () => ({
  getMatchOrThrow: matchMock,
  actionError: (_operation: string, error: unknown) => ({
    success: false,
    error: { message: error instanceof Error ? error.message : "unexpected error" },
  }),
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

import { readVetoRoom } from "@/actions/matches/veto-room";

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
  });

  it("allows a published season read when the resource belongs to that season", async () => {
    publicSeasonMock.mockResolvedValue({ id: "season-1", slug: "draft-season" });

    const result = await readVetoRoom("00000000-0000-4000-8000-000000000001");

    expect(result.success).toBe(true);
    expect(readViewMock).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
  });

  it("fails closed if the resolved public season id does not match the match owner", async () => {
    publicSeasonMock.mockResolvedValue({ id: "season-2", slug: "draft-season" });

    const result = await readVetoRoom("00000000-0000-4000-8000-000000000001");

    expect(result.success).toBe(false);
    expect(readViewMock).not.toHaveBeenCalled();
  });
});
