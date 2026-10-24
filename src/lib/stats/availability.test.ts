import { expect, it, vi } from "vitest";
import { preservePublicStatsDependencyFailure, readOptionalPublicStats } from "./availability";

vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/lib/observability/server", () => ({ captureException: vi.fn() }));

it("retains dependency classification across production Flight error redaction without downgrading program errors", async () => {
  const original = Object.assign(new Error("cancelled fixture read"), { code: "57014" });
  let digest: string | undefined;
  try { await preservePublicStatsDependencyFailure(async () => { throw original; }); }
  catch (error) {
    expect(error).toHaveProperty("cause", original);
    digest = (error as Error & { digest: string }).digest;
  }
  expect(digest).toBeTruthy();
  const transported = Object.assign(new Error("Production Server Components error"), { digest });
  expect(await readOptionalPublicStats("fixture", async () => { throw transported; })).toBeNull();
  const programError = new TypeError("invalid statistics projection");
  await expect(readOptionalPublicStats("fixture", () => preservePublicStatsDependencyFailure(async () => { throw programError; }))).rejects.toBe(programError);
});
