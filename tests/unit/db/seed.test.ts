import { afterEach, describe, expect, it, vi } from "vitest";

import { seed } from "@/db/seed";

describe("application seed", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not create administrator or other application rows", async () => {
    const logSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(seed()).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledOnce();
    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toMatchObject({
      event: "seed.no_application_rows",
      message: "No application seed rows configured.",
    });
  });
});
