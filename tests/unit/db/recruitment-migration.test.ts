import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "drizzle/migrations/0028_big_wilson_fisk.sql"), "utf8");

describe("Recruitment migration", () => {
  it("migrates legacy recruiting Teams before removing the second owner", () => {
    expect(migration).toContain('INSERT INTO "recruitment_intents"');
    expect(migration).toContain('WHERE "recruiting" = true AND "status" = \'active\'');
    expect(migration).toContain('ALTER TABLE "teams" DROP COLUMN "recruiting"');
  });

  it("keeps new discovery data deny-by-default in the Data API", () => {
    expect(migration).toContain('ALTER TABLE "recruitment_intents" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "recruitment_interests" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE "recruitment_intents", "recruitment_interests" FROM anon, authenticated');
  });
});
