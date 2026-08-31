import { afterEach, describe, expect, it, vi } from "vitest";

import { seed } from "@/db/seed";

describe("application seed", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not create administrator or other application rows", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(seed()).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith("No application seed rows configured.");
  });
});
