import { beforeEach, describe, expect, it, vi } from "vitest";

const { where } = vi.hoisted(() => ({ where: vi.fn() }));
vi.mock("@/db/client", () => ({
  db: { select: () => ({ from: () => ({ where }) }) },
}));

import { isStageComplete } from "@/lib/formats/_shared";

describe("shared stage completion rule", () => {
  beforeEach(() => where.mockReset());

  it.each([
    { total: 6, active: 0, complete: true },
    { total: 6, active: 1, complete: false },
    { total: 0, active: 0, complete: false },
  ])("requires existing matches and no active matches: %j", async ({ total, active, complete }) => {
    where.mockResolvedValueOnce([{ value: total }]).mockResolvedValueOnce([{ value: active }]);
    await expect(isStageComplete("season-1", "playoff")).resolves.toBe(complete);
  });
});
