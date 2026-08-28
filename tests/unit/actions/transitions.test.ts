import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePathMock = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { maybeAdvanceFromRegistration, maybeFinishSeason } from "@/actions/transitions";

function createTx(season: Record<string, unknown>, count = 0) {
  const selectMock = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn().mockResolvedValue([{ count }]),
    })),
  }));
  const updateSetMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));
  const insertValuesMock = vi.fn().mockResolvedValue(undefined);
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  return {
    tx: {
      query: { seasons: { findFirst: vi.fn().mockResolvedValue(season) } },
      select: selectMock,
      update: updateMock,
      insert: insertMock,
    },
    selectMock,
    updateMock,
    updateSetMock,
    insertMock,
  };
}

describe("season automatic transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not advance team registration into the solo lifecycle", async () => {
    const { tx, selectMock, updateMock, insertMock } = createTx({
      id: "season-1",
      slug: "major",
      status: "registration",
      registrationMode: "team",
      hasCaptainVoting: false,
      registrationConfig: { maxTotal: 1 },
      registrationDeadline: new Date(0),
    }, 1);

    await maybeAdvanceFromRegistration(tx as never, "season-1");

    expect(selectMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("keeps the existing solo auto-advance path", async () => {
    const { tx, updateSetMock, insertMock } = createTx({
      id: "season-1",
      slug: "rivals",
      status: "registration",
      registrationMode: "solo",
      hasCaptainVoting: false,
      registrationConfig: { maxTotal: 1 },
      registrationDeadline: null,
    }, 1);

    await maybeAdvanceFromRegistration(tx as never, "season-1");

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: "playing" }));
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("does not auto-finish a season whose stage plan contains Swiss", async () => {
    const { tx, selectMock, updateMock, insertMock } = createTx({
      id: "season-1",
      slug: "major",
      status: "playing",
      stagePlan: [
        { key: "opening", name: "Opening", type: "swiss", teamCount: 32, advanceTiers: [] },
        { key: "playoff", name: "Playoff", type: "single_elim", teamCount: 8, advanceTiers: [] },
      ],
    });

    await maybeFinishSeason(tx as never, "season-1");

    expect(selectMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("finishes a non-Swiss season when the last match is finished", async () => {
    const { tx, updateSetMock, insertMock } = createTx({
      id: "season-1",
      slug: "rivals",
      status: "playing",
      stagePlan: [
        { key: "playoff", name: "Playoff", type: "double_elim", teamCount: 8, advanceTiers: [] },
      ],
    });

    await maybeFinishSeason(tx as never, "season-1");

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: "finished" }));
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("finishes a non-Swiss season when the last match is cancelled", async () => {
    const { tx, updateSetMock, insertMock } = createTx({
      id: "season-1",
      slug: "rivals",
      status: "playing",
      stagePlan: [
        { key: "playoff", name: "Playoff", type: "double_elim", teamCount: 8, advanceTiers: [] },
      ],
    });

    await maybeFinishSeason(tx as never, "season-1");

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: "finished" }));
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
