import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "drizzle/migrations/0012_dapper_devos.sql"),
  "utf8",
);

describe("0012 competitive profile migration", () => {
  it("keeps competitive profile tables deny-by-default for the Data API", () => {
    expect(migration).toMatch(
      /ALTER TABLE "competitive_platform_seasons" ENABLE ROW LEVEL SECURITY;/,
    );
    expect(migration).toMatch(
      /ALTER TABLE "competitive_rank_facts" ENABLE ROW LEVEL SECURITY;/,
    );
    expect(migration).toContain(
      "REVOKE ALL ON competitive_platform_seasons, competitive_rank_facts FROM anon, authenticated;",
    );
  });

  it("keeps the active journal's final entry at 0012", () => {
    const journal = JSON.parse(
      readFileSync(join(process.cwd(), "drizzle/migrations/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };

    expect(journal.entries.at(-1)).toEqual({
      idx: 12,
      version: "7",
      when: 1787854784019,
      tag: "0012_dapper_devos",
      breakpoints: true,
    });
  });

  it("keeps the generated snapshot aligned with normalized Perfect ID uniqueness", () => {
    const snapshot = readFileSync(
      join(process.cwd(), "drizzle/migrations/meta/0012_snapshot.json"),
      "utf8",
    );

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "users_perfect_id_normalized_unique" ON "users" USING btree (lower(btrim("perfect_id")));',
    );
    expect(snapshot).toContain('"expression": "lower(btrim(\\"perfect_id\\"))"');
    expect(snapshot).not.toContain('"expression": "lower(\\"perfect_id\\")"');
  });
});
