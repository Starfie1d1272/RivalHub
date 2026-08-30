import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "drizzle/migrations/0018_competitive_platform_catalog.sql"),
  "utf8",
);

describe("0018 competitive platform catalog migration", () => {
  it("creates the platform identity table and the platform-owned rank ladder", () => {
    expect(migration).toContain('CREATE TABLE "competitive_platforms"');
    expect(migration).toContain('CREATE TABLE "competitive_platform_ranks"');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "competitive_platform_ranks_platform_rank_key_unique" ON "competitive_platform_ranks" USING btree ("platform_key","rank_key");',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "competitive_platform_ranks_platform_sort_order_unique" ON "competitive_platform_ranks" USING btree ("platform_key","sort_order");',
    );
  });

  it("removes the season-level rank order as a source of truth", () => {
    expect(migration).toContain('ALTER TABLE "competitive_platform_seasons" DROP COLUMN "rank_order";');
  });

  it("fails closed on conflicting non-empty rank orders with operator reconciliation guidance", () => {
    expect(migration).toMatch(/HAVING COUNT\(DISTINCT \(to_jsonb\(rank_order\)\)::text\) > 1/);
    expect(migration).toContain("RAISE EXCEPTION");
    expect(migration).toMatch(/fail-?\s?closed/i);
    expect(migration).toContain("段位体系");
  });

  it("backfills platform identity and promotes identical rank orders into the ladder", () => {
    expect(migration).toMatch(/INSERT INTO "competitive_platforms"/);
    expect(migration).toContain("'perfect_world' THEN '完美世界竞技平台'");
    expect(migration).toMatch(/INSERT INTO "competitive_platform_ranks"/);
    expect(migration).toContain("jsonb_array_elements_text(picked.order_json::jsonb) WITH ORDINALITY");
    expect(migration).toContain("DISTINCT ON (s.platform)");
  });

  it("keeps the new tables deny-by-default for the Data API", () => {
    expect(migration).toMatch(/ALTER TABLE "competitive_platforms" ENABLE ROW LEVEL SECURITY;/);
    expect(migration).toMatch(/ALTER TABLE "competitive_platform_ranks" ENABLE ROW LEVEL SECURITY;/);
    expect(migration).toContain(
      "REVOKE ALL ON competitive_platforms, competitive_platform_ranks FROM anon, authenticated;",
    );
  });

  it("keeps the active journal aligned with the catalog migration", () => {
    const journal = JSON.parse(
      readFileSync(join(process.cwd(), "drizzle/migrations/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 19,
      version: "7",
      tag: "0019_competitive-platform-rating-semantics",
      breakpoints: true,
    });
  });

  it("keeps the generated snapshot free of season-level rank_order", () => {
    const snapshot = readFileSync(
      join(process.cwd(), "drizzle/migrations/meta/0018_snapshot.json"),
      "utf8",
    );
    expect(snapshot).toContain('"competitive_platforms"');
    expect(snapshot).toContain('"competitive_platform_ranks"');
    expect(snapshot).not.toContain('"rank_order"');
  });
});
