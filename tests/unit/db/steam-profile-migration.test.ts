import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { users } from "@/db/schema/users";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0052_gray_supernaut.sql"),
  "utf8",
);
const cleanupMigration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0055_steam_profile_shadow_cleanup.sql"),
  "utf8",
);

describe("0052 Steam profile foundation migration", () => {
  it("creates the reusable identity and official-profile boundaries", () => {
    expect(migration).toContain('CREATE TABLE "steam_profiles"');
    expect(migration).toContain('CREATE TABLE "user_gameplay_steam_ids"');
    expect(migration).toContain('"users_active_steam64_unique"');
    expect(migration).toContain('"users_steam64_shape_check"');
    expect(migration).toContain('"user_gameplay_steam_ids_steam64_shape_check"');
    expect(migration).toContain('"avatar_url" text,');
    expect(migration).toContain('ALTER TABLE "steam_profiles" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "user_gameplay_steam_ids" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE "steam_profiles", "user_gameplay_steam_ids" FROM anon, authenticated',
    );
  });

  it("keeps legacy columns through the N/N+1 compatibility window", () => {
    expect(migration).toContain("N/N+1 compatibility window");
    expect(migration).not.toContain('DROP COLUMN "steam_name"');
    expect(migration).not.toContain('DROP COLUMN "steam_profile_url"');
    expect(migration).not.toContain('DROP COLUMN "avatar_url"');
  });
});

describe("users application schema contract", () => {
  it("ensures users application schema does not include legacy shadow columns", () => {
    const userColumns = Object.keys(users);
    expect(userColumns).not.toContain("steamName");
    expect(userColumns).not.toContain("steamProfileUrl");
    expect(userColumns).not.toContain("avatarUrl");
  });
});

describe("0055 Steam profile shadow cleanup migration", () => {
  it("physically drops all three retired users columns after the compatibility window", () => {
    expect(cleanupMigration).toContain('ALTER TABLE "public"."users" DROP COLUMN "steam_name"');
    expect(cleanupMigration).toContain('DROP COLUMN "steam_profile_url"');
    expect(cleanupMigration).toContain('DROP COLUMN "avatar_url"');
    expect(cleanupMigration).toContain("v2.12.2 is Production without readers or writers");
  });
});
