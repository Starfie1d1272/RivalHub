import { describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import { coverageAllocations, coverageHolds, officialCoverageSlots, type Match } from "@/db/schema";
import { holdCoverageInTx } from "./coverage";

describe("coverage scheduling ownership", () => {
  it("keeps an existing allocation while a replacement time is only being proposed", async () => {
    const now = new Date("2026-09-29T10:00:00.000Z");
    const scheduledAt = new Date("2026-09-29T11:00:00.000Z");
    const slot = {
      id: "slot-1",
      seasonId: "season-1",
      startsAt: new Date("2026-09-29T10:30:00.000Z"),
      endsAt: new Date("2026-09-29T12:30:00.000Z"),
      capacity: 2,
    };
    const match = {
      id: "match-1",
      seasonId: "season-1",
      status: "scheduled",
    } as Match;
    const updatedTables: unknown[] = [];

    const tx = {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(() => {
            if (table === officialCoverageSlots) {
              return { for: vi.fn().mockResolvedValue([slot]) };
            }
            if (table === coverageHolds || table === coverageAllocations) {
              return Promise.resolve([{ total: 0 }]);
            }
            throw new Error("unexpected coverage select");
          }),
        })),
      })),
      update: vi.fn((table: unknown) => {
        updatedTables.push(table);
        return {
          set: vi.fn(() => ({
            where: vi.fn().mockResolvedValue(undefined),
          })),
        };
      }),
      insert: vi.fn((table: unknown) => {
        if (table !== coverageHolds) throw new Error("unexpected coverage insert");
        return {
          values: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{
              id: "hold-1",
              slotId: slot.id,
              matchId: match.id,
              proposedScheduledAt: scheduledAt,
              expiresAt: new Date(now.getTime() + 15 * 60_000),
              releasedAt: null,
            }]),
          })),
        };
      }),
    } as unknown as TxDb;

    await holdCoverageInTx(tx, match, slot.id, scheduledAt, now);

    expect(updatedTables).toContain(coverageHolds);
    expect(updatedTables).not.toContain(coverageAllocations);
  });
});
