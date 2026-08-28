import { beforeEach, describe, expect, it, vi } from "vitest";

const { where, from, select } = vi.hoisted(() => {
  const where = vi.fn();
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { where, from, select };
});

vi.mock("@/db/client", () => ({ db: { select } }));

import { getParticipantSummary } from "@/lib/participants/summary";

describe("getParticipantSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses formal team membership for a team season", async () => {
    where.mockResolvedValue([{ value: 6 }]);

    await expect(getParticipantSummary({ id: "season-1", registrationMode: "team" })).resolves.toEqual({ count: 6, hasPlayers: true });
    expect(select).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledOnce();
  });

  it("uses approved registrations for a solo season", async () => {
    where.mockResolvedValue([{ value: 0 }]);

    await expect(getParticipantSummary({ id: "season-1", registrationMode: "solo" })).resolves.toEqual({ count: 0, hasPlayers: false });
  });
});
