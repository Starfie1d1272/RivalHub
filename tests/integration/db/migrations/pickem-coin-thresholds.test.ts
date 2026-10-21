import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";

it("updates only the approved event's previous coin thresholds, keeps rules and audit idempotent", async () => {
  await withScratchDatabase("rh_pickem_coin", async client => {
    const target = "0093_pickem_coin_thresholds.sql";
    for (const file of migrationFiles(name => /^\d{4}_.*\.sql$/.test(name) && name < target)) await replayMigration(client, file);
    const id = randomUUID(), other = randomUUID();
    await client.query("INSERT INTO seasons (id,slug,name,kind,status) VALUES ($1,'2026-nju-major','Major','custom','playing'),($2,$3,'Other','custom','playing')", [id, other, `other-${other}`]);
    const rules = { silver: 4, gold: 6, diamond: 8, swissTarget: 5, cutoffMinutes: 5 };
    await client.query("INSERT INTO prediction_programs (season_id,rules) VALUES ($1,$3),($2,$3)", [id, other, rules]);
    await replayMigration(client, target);
    expect((await client.query("SELECT rules FROM prediction_programs WHERE season_id=$1", [id])).rows[0].rules).toEqual({ ...rules, silver: 2, gold: 5 });
    expect((await client.query("SELECT rules FROM prediction_programs WHERE season_id=$1", [other])).rows[0].rules).toEqual(rules);
    await replayMigration(client, target);
    expect((await client.query("SELECT count(*)::int AS n FROM audit_logs WHERE season_id=$1 AND meta->>'migration'='0093_pickem_coin_thresholds'", [id])).rows[0].n).toBe(1);
  });
});
