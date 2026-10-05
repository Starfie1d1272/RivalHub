import { describe, expect, it } from "vitest";
import { replayMigration, withScratchDatabase } from "../harness/migration-replay";

describe("hosted Realtime receive policy bootstrap", () => {
  it("is repeatable and permits only scoped Broadcast reads, never viewer writes", async () => {
    await withScratchDatabase("live_policy", async (client) => {
      await client.query(`
        CREATE SCHEMA auth; CREATE SCHEMA realtime;
        CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
          $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
        CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS
          $$ SELECT current_setting('request.topic', true) $$;
        CREATE TABLE realtime.messages (extension text);
        ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
        INSERT INTO realtime.messages VALUES ('broadcast'), ('presence');
        GRANT USAGE ON SCHEMA auth, realtime TO authenticated;
        GRANT SELECT, INSERT ON realtime.messages TO authenticated;
      `);
      await replayMigration(client, "0071_restore_private_live_broadcast_policy.sql");
      await replayMigration(client, "0071_restore_private_live_broadcast_policy.sql");
      const matchId = "11111111-1111-4111-8111-111111111111";
      await client.query("SELECT set_config('request.jwt.claims', $1, false), set_config('request.topic', $2, false)", [JSON.stringify({ scope: "live-viewer", matchId }), `match-live:${matchId}`]);
      await client.query("SET ROLE authenticated");
      expect((await client.query("SELECT extension FROM realtime.messages")).rows).toEqual([{ extension: "broadcast" }]);
      await expect(client.query("INSERT INTO realtime.messages VALUES ('broadcast')")).rejects.toMatchObject({ code: "42501" });
      await client.query("SELECT set_config('request.topic', $1, false)", ["match-live:22222222-2222-4222-8222-222222222222"]);
      expect((await client.query("SELECT extension FROM realtime.messages")).rows).toEqual([]);
      await client.query("SELECT set_config('request.jwt.claims', '{}', false)");
      expect((await client.query("SELECT extension FROM realtime.messages")).rows).toEqual([]);
      await client.query("RESET ROLE");
    });
  });
});
