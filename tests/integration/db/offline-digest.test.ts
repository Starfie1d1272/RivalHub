import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createLocalPool } from "./harness/database";

it("verifies the fixture-only canonical chunk contract on real PostgreSQL", async () => {
  const pool = createLocalPool({ max: 1 });
  const client = await pool.connect();
  const notices: string[] = [];
  client.on("notice", (notice) => { if (notice.message?.startsWith("PASS:")) notices.push(notice.message); });
  try {
    await client.query(readFileSync("scripts/db/recovery/offline-digest.sql", "utf8"));
    await client.query(readFileSync("tests/fixtures/recovery/offline-digest.sql", "utf8"));
    expect(notices).toHaveLength(2);
    expect(notices[0]).toContain("exact numeric, UTC microseconds, NULL and UTF8");
    expect(notices[1]).toContain("fail closed");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
