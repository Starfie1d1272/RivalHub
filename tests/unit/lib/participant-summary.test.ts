import { beforeEach, describe, expect, it, vi } from "vitest";

const { where, innerJoin, from, select } = vi.hoisted(() => {
  const where = vi.fn();
  const innerJoin = vi.fn(() => ({ innerJoin, where }));
  const from = vi.fn(() => ({ innerJoin, where }));
  const select = vi.fn(() => ({ from }));
  return { where, innerJoin, from, select };
});

vi.mock("@/db/client", () => ({ db: { select } }));

import { getParticipantSummary } from "@/lib/participants/summary";

describe("getParticipantSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the frozen event roster for a team season", async () => {
    where.mockResolvedValue([{ value: 6 }]);

    await expect(getParticipantSummary({ id: "season-1", registrationMode: "team" })).resolves.toEqual({ count: 6, hasPlayers: true });
    expect(select).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledOnce();
    expect(innerJoin).toHaveBeenCalledTimes(2);
  });

  it("uses approved registrations for a solo season", async () => {
    where.mockResolvedValue([{ value: 0 }]);

    await expect(getParticipantSummary({ id: "season-1", registrationMode: "solo" })).resolves.toEqual({ count: 0, hasPlayers: false });
  });
});
