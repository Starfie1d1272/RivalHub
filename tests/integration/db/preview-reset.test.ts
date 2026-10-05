import { describe, expect, it } from "vitest";
import { resetDevSchema } from "../../../scripts/db/preview/refresh";
import { withScratchDatabase } from "./harness/migration-replay";

describe("preview schema reset", () => {
  it("removes only the application Broadcast policy so migrations can recreate it", async () => {
    await withScratchDatabase("preview_reset", async (client) => {
      await client.query(`CREATE SCHEMA realtime;
        CREATE TABLE realtime.messages (extension text);
        CREATE POLICY rivalhub_match_live_receive ON realtime.messages FOR SELECT USING (true);
        CREATE POLICY provider_owned ON realtime.messages FOR SELECT USING (false);`);
      await resetDevSchema(client);
      expect((await client.query("SELECT policyname FROM pg_policies WHERE schemaname = 'realtime' ORDER BY policyname")).rows)
        .toEqual([{ policyname: "provider_owned" }]);
      await client.query("CREATE POLICY rivalhub_match_live_receive ON realtime.messages FOR SELECT USING (true)");
      await resetDevSchema(client);
      await resetDevSchema(client);
      expect((await client.query("SELECT policyname FROM pg_policies WHERE schemaname = 'realtime'")).rows)
        .toEqual([{ policyname: "provider_owned" }]);
    });
  });

  it("resets a fresh project before Realtime has initialized its managed table", async () => {
    await withScratchDatabase("preview_reset_fresh", async (client) => {
      await resetDevSchema(client);
      await resetDevSchema(client);
      expect((await client.query("SELECT to_regnamespace('public') IS NOT NULL AS ready")).rows)
        .toEqual([{ ready: true }]);
    });
  });
});
