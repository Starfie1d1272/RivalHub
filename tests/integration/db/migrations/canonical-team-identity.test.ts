import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { replayMigration, withScratchDatabase } from "../harness/migration-replay";

// A populated legacy bridge, including bad provenance that empty replay cannot catch.
async function legacy(client: Parameters<Parameters<typeof withScratchDatabase>[1]>[0]) {
  const season = randomUUID(), otherSeason = randomUUID(), user = randomUUID(), registration = randomUUID(), team = randomUUID();
  await client.query(`
    CREATE TABLE seasons (id uuid PRIMARY KEY);
    CREATE TABLE users (id uuid PRIMARY KEY);
    CREATE TABLE season_registrations (id uuid PRIMARY KEY, season_id uuid, user_id uuid);
    CREATE TABLE teams (id uuid PRIMARY KEY, season_id uuid, captain_registration_id uuid NOT NULL);
    CREATE TABLE team_members (id uuid PRIMARY KEY, team_id uuid, registration_id uuid NOT NULL);
  `);
  await client.query("INSERT INTO seasons VALUES ($1), ($2)", [season, otherSeason]);
  await client.query("INSERT INTO users VALUES ($1)", [user]);
  await client.query("INSERT INTO season_registrations VALUES ($1,$2,$3)", [registration, season, user]);
  await client.query("INSERT INTO teams VALUES ($1,$2,$3)", [team, season, registration]);
  await client.query("INSERT INTO team_members VALUES ($1,$2,$3)", [randomUUID(), team, registration]);
  return { season, otherSeason, user, registration, team };
}

describe("populated canonical team identity migration", () => {
  it("backfills identity and installs real uniqueness, FK and NOT NULL constraints", async () => {
    await withScratchDatabase("team_bridge", async client => {
      const f = await legacy(client);
      await replayMigration(client, "0001_canonical_team_identity.sql");
      expect((await client.query("SELECT captain_user_id FROM teams")).rows).toEqual([{ captain_user_id: f.user }]);
      expect((await client.query("SELECT user_id, season_id FROM team_members")).rows).toEqual([{ user_id: f.user, season_id: f.season }]);
      await expect(client.query("INSERT INTO team_members VALUES ($1,$2,$3,$4,$5)", [randomUUID(), f.team, f.registration, f.season, f.user])).rejects.toMatchObject({ code: "23505" });
      await expect(client.query("UPDATE team_members SET season_id = $1", [f.otherSeason])).rejects.toMatchObject({ code: "23503" });
      await expect(client.query("UPDATE teams SET captain_user_id = NULL")).rejects.toMatchObject({ code: "23502" });
    });
  });

  it.each(["captain-provenance", "member-provenance", "duplicate", "missing-captain", "missing-member", "orphan-team"])("fails closed and preserves legacy facts for %s", async scenario => {
    await withScratchDatabase("bad_team_bridge", async client => {
      const f = await legacy(client);
      if (scenario === "captain-provenance") await client.query("UPDATE teams SET season_id = $1", [f.otherSeason]);
      if (scenario === "member-provenance") {
        const other = randomUUID();
        await client.query("INSERT INTO season_registrations VALUES ($1,$2,$3)", [other, f.otherSeason, f.user]);
        await client.query("UPDATE team_members SET registration_id = $1", [other]);
      }
      if (scenario === "duplicate") await client.query("INSERT INTO team_members SELECT $1, team_id, registration_id FROM team_members", [randomUUID()]);
      if (scenario === "missing-captain") await client.query("UPDATE teams SET captain_registration_id = $1", [randomUUID()]);
      if (scenario === "missing-member") await client.query("UPDATE team_members SET registration_id = $1", [randomUUID()]);
      if (scenario === "orphan-team") await client.query("UPDATE team_members SET team_id = $1", [randomUUID()]);
      const before = (await client.query("SELECT * FROM team_members")).rows;
      await expect(replayMigration(client, "0001_canonical_team_identity.sql")).rejects.toThrow();
      expect((await client.query("SELECT * FROM team_members")).rows).toEqual(before);
      expect((await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'team_members' AND column_name = 'user_id'")).rows).toEqual([]);
    });
  });
});
