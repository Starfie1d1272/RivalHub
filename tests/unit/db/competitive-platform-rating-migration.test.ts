import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "drizzle/migrations/0019_competitive-platform-rating-semantics.sql"),
  "utf8",
);

describe("0019 competitive platform rating semantics migration", () => {
  it("backfills canonical performance Rating labels without treating ladder score as Rating", () => {
    expect(migration).toContain('ADD COLUMN "rating_label" text NOT NULL DEFAULT \'Rating\'');
    expect(migration).toContain("'Rating Pro' WHERE \"key\" = 'perfect_world'");
    expect(migration).toContain('ALTER COLUMN "rating_label" DROP DEFAULT');
  });
});
