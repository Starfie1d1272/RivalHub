import { describe, expect, it, vi } from "vitest";
import { writeAuditInTx } from "@/lib/audit/write";

describe("writeAuditInTx", () => {
  it("uses the registry target type while preserving the single-event write shape", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const tx = { insert: vi.fn(() => ({ values })) } as never;

    await writeAuditInTx(tx, {
      action: "announcement.create",
      actorId: "admin-1",
      targetId: "announcement-1",
    });

    expect(values).toHaveBeenCalledWith({
      action: "announcement.create",
      actorId: "admin-1",
      meta: null,
      seasonId: null,
      targetId: "announcement-1",
      targetType: "announcement",
    });
  });

  it("does not expose a producer-selected target type", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const tx = { insert: vi.fn(() => ({ values })) } as never;

    await writeAuditInTx(tx, {
      action: "recruitment.interest.withdraw",
      actorId: "admin-1",
      targetId: "intent-1",
      targetType: "recruitment_interest",
    } as never);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      targetId: "intent-1",
      targetType: "recruitment_intent",
    }));
  });
});
