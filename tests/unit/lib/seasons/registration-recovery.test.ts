import { beforeEach, describe, expect, it, vi } from "vitest";

const { eqMock, openSeasonRegistrationInTxMock } = vi.hoisted(() => ({
  eqMock: vi.fn(() => "season-filter"),
  openSeasonRegistrationInTxMock: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({ eq: eqMock }));
vi.mock("@/db/schema", () => ({ seasons: { id: "seasons.id" } }));
vi.mock("@/lib/seasons/lifecycle", () => ({
  openSeasonRegistrationInTx: openSeasonRegistrationInTxMock,
}));

import { ensureRegistrationOpenForParticipantInTx } from "@/lib/seasons/registration-recovery";

function txWithRows(...rows: unknown[]) {
  const selectMock = vi.fn();
  rows.forEach((row, index) => {
    const query = index === 0
      ? {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockResolvedValue(row ? [row] : []),
        }
      : {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue(row ? [row] : []),
        };
    selectMock.mockReturnValueOnce(query);
  });
  return { select: selectMock };
}

const baseSeason = {
  id: "season-1",
  status: "registration",
  registrationOpensAt: new Date("2026-09-09T05:00:00.000Z"),
  registrationOpenedAt: null,
  registrationClosesAt: null,
};

describe("registration opening recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not open before the scheduled time", async () => {
    const tx = txWithRows(baseSeason);

    const result = await ensureRegistrationOpenForParticipantInTx(
      tx as never,
      baseSeason.id,
      new Date("2026-09-09T04:59:59.000Z"),
    );

    expect(result).toEqual({ season: baseSeason, opened: false });
    expect(openSeasonRegistrationInTxMock).not.toHaveBeenCalled();
  });

  it("opens a due season inside the caller transaction and rereads the fact", async () => {
    const openedSeason = { ...baseSeason, registrationOpenedAt: new Date("2026-09-09T05:00:00.000Z") };
    const tx = txWithRows(baseSeason, openedSeason);
    openSeasonRegistrationInTxMock.mockResolvedValue({ opened: true });

    const result = await ensureRegistrationOpenForParticipantInTx(
      tx as never,
      baseSeason.id,
      new Date("2026-09-09T05:00:00.000Z"),
    );

    expect(openSeasonRegistrationInTxMock).toHaveBeenCalledWith(tx, {
      seasonId: baseSeason.id,
      actorId: "system",
      now: new Date("2026-09-09T05:00:00.000Z"),
    });
    expect(result).toEqual({ season: openedSeason, opened: true });
  });

  it("fails closed after the registration deadline", async () => {
    const season = {
      ...baseSeason,
      registrationClosesAt: new Date("2026-09-09T04:00:00.000Z"),
    };
    const tx = txWithRows(season);

    const result = await ensureRegistrationOpenForParticipantInTx(
      tx as never,
      season.id,
      new Date("2026-09-09T05:00:00.000Z"),
    );

    expect(result).toEqual({ season, opened: false });
    expect(openSeasonRegistrationInTxMock).not.toHaveBeenCalled();
  });
});
