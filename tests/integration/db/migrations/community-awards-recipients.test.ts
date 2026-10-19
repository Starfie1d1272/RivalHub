import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";

const target = "0090_yellow_blink.sql";

describe("community awards N/N+1 expand and legacy bridge", () => {
  it("preserves published singleton history and synchronizes/fences shipped writes with deferred constraints", async () => {
    await withScratchDatabase("rh_award_recipients", async client => {
      for (const name of migrationFiles(name => /^\d{4}_.*\.sql$/.test(name) && name < target)) await replayMigration(client, name);
      const season = randomUUID(), first = randomUUID(), second = randomUUID(), award = randomUUID();
      await client.query("INSERT INTO seasons (id,slug,name,kind,status) VALUES ($1,$2,'Legacy','custom','finished')", [season, `legacy-${season}`]);
      for (const id of [first, second]) await client.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,'Legacy recipient')", [id, `${id}@local.test`]);
      await client.query("INSERT INTO community_awards (id,season_id,submitted_by_user_id,name,condition,prize,status,reviewed_by_user_id,reviewed_at,recipient_user_id,outcome_by_user_id,outcome_at,outcome_note) VALUES ($1,$2,$3,'Legacy award','Legacy condition','Legacy prize','awarded',$3,now(),$3,$3,now(),'Published result')", [award, season, first]);
      const before = (await client.query("SELECT * FROM community_awards WHERE id=$1", [award])).rows[0];
      await client.query("UPDATE seasons SET status='registration' WHERE id=$1", [season]);
      await replayMigration(client, target);
      const after = (await client.query("SELECT * FROM community_awards WHERE id=$1", [award])).rows[0];
      for (const [key, value] of Object.entries(before)) expect(after[key]).toEqual(value);
      expect(after).toMatchObject({ recipient_policy: "single", settlement_policy: "season_complete", result_version: 0 });
      expect((await client.query("SELECT user_id,position FROM community_award_recipients WHERE award_id=$1", [award])).rows).toEqual([{ user_id: first, position: 0 }]);
      await client.query("UPDATE seasons SET status='finished' WHERE id=$1", [season]);
      // Exact previous writer's column contract, exercised after expansion.
      await client.query("UPDATE community_awards SET status='awarded',recipient_user_id=$2,outcome_note='Legacy correction',outcome_at=now(),outcome_by_user_id=$2 WHERE id=$1", [award, second]);
      expect((await client.query("SELECT user_id FROM community_award_recipients WHERE award_id=$1", [award])).rows).toEqual([{ user_id: second }]);
      expect((await client.query("SELECT meta FROM audit_logs WHERE target_id=$1 AND action='community_award.legacy.resolve'", [award])).rows[0].meta).toMatchObject({ previousRecipientUserIds: [first], recipientUserIds: [second], previousOutcomeNote: "Published result", outcomeNote: "Legacy correction" });
      await expect(client.query("INSERT INTO community_award_recipients (award_id,user_id,position) VALUES ($1,$2,1)", [award, second])).rejects.toMatchObject({ code: "23505" });
      await expect(client.query("DELETE FROM community_award_recipients WHERE award_id=$1", [award])).rejects.toMatchObject({ code: "23514" });
      await client.query("BEGIN");
      await client.query("SELECT set_config('rivalhub.community_awards_writer','recipients-v1',true)");
      await client.query("UPDATE community_awards SET recipient_policy='limited',recipient_limit=3 WHERE id=$1", [award]);
      await client.query("INSERT INTO community_award_recipients (award_id,user_id,position) VALUES ($1,$2,1)", [award, first]);
      await client.query("COMMIT");
      // Old reads still see a real awarded recipient; full lists belong to the new reader.
      expect((await client.query("SELECT status,recipient_user_id FROM community_awards WHERE id=$1", [award])).rows[0]).toEqual({ status: "awarded", recipient_user_id: second });
      await expect(client.query("UPDATE community_awards SET recipient_user_id=$2,outcome_note='Old writer truncation',outcome_at=now() WHERE id=$1", [award, first])).rejects.toMatchObject({ code: "23514" });
      expect((await client.query("SELECT user_id FROM community_award_recipients WHERE award_id=$1", [award])).rows).toHaveLength(2);
      await expect(client.query("UPDATE community_awards SET recipient_policy='single',recipient_limit=1 WHERE id=$1", [award])).rejects.toMatchObject({ code: "23514" });
      await expect(client.query("INSERT INTO community_award_recipients (award_id,user_id,position) VALUES ($1,$2,1)", [randomUUID(), first])).rejects.toMatchObject({ code: "23503" });
      const privilege = (await client.query("SELECT relrowsecurity AS rls,has_table_privilege('anon',oid,'select') AS anon,has_table_privilege('authenticated',oid,'insert') AS authenticated FROM pg_class WHERE relname='community_award_recipients'")).rows[0];
      expect(privilege).toEqual({ rls: true, anon: false, authenticated: false });
      await client.query("BEGIN");
      await client.query("SELECT set_config('rivalhub.community_awards_writer','recipients-v1',true)");
      await client.query("DELETE FROM community_award_recipients WHERE award_id=$1", [award]);
      await client.query("UPDATE community_awards SET recipient_policy='single',recipient_limit=1,status='not_awarded',recipient_user_id=NULL WHERE id=$1", [award]);
      await client.query("COMMIT");
      await client.query("UPDATE seasons SET status='registration' WHERE id=$1", [season]);
      await expect(client.query("UPDATE community_awards SET status='awarded',recipient_user_id=$2 WHERE id=$1", [award, first])).rejects.toMatchObject({ code: "23514" });
    });
  });
});
