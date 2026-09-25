import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { users } from "@/db/schema/users";

const migration52 = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0052_gray_supernaut.sql"),
  "utf8",
);

const migration55 = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0055_steam_profile_contract_cleanup.sql"),
  "utf8",
);

const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), "drizzle/migrations/meta/_journal.json"), "utf8"),
);

describe("0052 Steam profile foundation migration", () => {
  it("creates the reusable identity and official-profile boundaries", () => {
    expect(migration52).toContain('CREATE TABLE "steam_profiles"');
    expect(migration52).toContain('CREATE TABLE "user_gameplay_steam_ids"');
    expect(migration52).toContain('"users_active_steam64_unique"');
    expect(migration52).toContain('"users_steam64_shape_check"');
    expect(migration52).toContain('"user_gameplay_steam_ids_steam64_shape_check"');
    expect(migration52).toContain('"avatar_url" text,');
    expect(migration52).toContain('ALTER TABLE "steam_profiles" ENABLE ROW LEVEL SECURITY');
    expect(migration52).toContain('ALTER TABLE "user_gameplay_steam_ids" ENABLE ROW LEVEL SECURITY');
    expect(migration52).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE "steam_profiles", "user_gameplay_steam_ids" FROM anon, authenticated',
    );
  });

  it("keeps legacy columns through the N/N+1 compatibility window", () => {
    expect(migration52).toContain("N/N+1 compatibility window");
    expect(migration52).not.toContain('DROP COLUMN "steam_name"');
    expect(migration52).not.toContain('DROP COLUMN "steam_profile_url"');
    expect(migration52).not.toContain('DROP COLUMN "avatar_url"');
  });
});

describe("0055 Steam profile contract cleanup migration", () => {
  it("physically drops legacy steam projection columns with contract-cleanup annotation", () => {
    expect(migration55).toContain("-- rivalhub:migration-risk: contract-cleanup");
    expect(migration55).toContain('DROP COLUMN "steam_name"');
    expect(migration55).toContain('DROP COLUMN "steam_profile_url"');
    expect(migration55).toContain('DROP COLUMN "avatar_url"');
  });

  it("ensures users application schema does not include legacy shadow columns", () => {
    const userColumns = Object.keys(users);
    expect(userColumns).not.toContain("steamName");
    expect(userColumns).not.toContain("steamProfileUrl");
    expect(userColumns).not.toContain("avatarUrl");
  });

  it("is registered in migration journal", () => {
    const entry = journal.entries.find((e: { tag: string }) => e.tag === "0055_steam_profile_contract_cleanup");
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(55);
  });
});
