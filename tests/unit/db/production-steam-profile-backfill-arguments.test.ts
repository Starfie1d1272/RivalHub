import { describe, expect, it } from "vitest";
import { buildProductionBackfillInvocation } from "../../../scripts/db/production-steam-profile-backfill-arguments";

describe("production Steam profile backfill argv", () => {
  it("strips pnpm argument separators before invoking the inner backfill", () => {
    expect(buildProductionBackfillInvocation(["--", "--apply"])).toEqual({
      apply: true,
      args: [
        "scripts/db/run-server-cli.ts",
        "scripts/db/steam-profile-backfill.ts",
        "--apply",
      ],
    });
  });

  it("preserves direct flags and dry-run limit semantics", () => {
    expect(buildProductionBackfillInvocation(["--apply", "--limit", "5"])).toEqual({
      apply: true,
      args: [
        "scripts/db/run-server-cli.ts",
        "scripts/db/steam-profile-backfill.ts",
        "--apply",
        "--limit",
        "5",
      ],
    });

    expect(buildProductionBackfillInvocation(["--", "--limit", "3"])).toEqual({
      apply: false,
      args: [
        "scripts/db/run-server-cli.ts",
        "scripts/db/steam-profile-backfill.ts",
        "--limit",
        "3",
      ],
    });
  });
});
