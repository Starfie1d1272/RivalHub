import { describe, expect, it } from "vitest";
import { replayMigration, withScratchDatabase } from "../harness/migration-replay";

describe("Supabase organization Storage origin migration", () => {
  it("preserves paths and external origins while relocating public asset URLs", async () => {
    await withScratchDatabase("storage_origin", async (client) => {
      const oldOrigin = "https://sucokfotkypwqkckfynp.supabase.co/storage/v1/object/public/";
      const newOrigin = "https://rrrebbxfghmgnoyyeqqd.supabase.co/storage/v1/object/public/";
      const values = [`${oldOrigin}team-logos/a%20b.png`, "https://example.com/logo.png", `${newOrigin}season-public-assets/logo.png`, null];
      for (const table of ["teams", "competition_entries", "seasons"]) {
        await client.query(`CREATE TABLE ${table} (id integer, logo_url text)`);
        for (const [id, value] of values.entries()) await client.query(`INSERT INTO ${table} VALUES ($1, $2)`, [id, value]);
      }
      await replayMigration(client, "0070_supabase_organization_storage_urls.sql");
      for (const table of ["teams", "competition_entries", "seasons"]) {
        const result = await client.query(`SELECT logo_url FROM ${table} ORDER BY id`);
        expect(result.rows.map((row) => row.logo_url)).toEqual([`${newOrigin}team-logos/a%20b.png`, ...values.slice(1)]);
      }
      await replayMigration(client, "0070_supabase_organization_storage_urls.sql");
    });
  });
});
