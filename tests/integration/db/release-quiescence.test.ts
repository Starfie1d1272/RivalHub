import { describe, expect, it } from "vitest";
import { createLocalPool } from "./harness/database";
import { localDatabaseUrl } from "./harness/database";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { quiescenceSql, waitForDatabaseQuiescence } from "../../../scripts/standby/production-quiescence.mjs";

describe("release database writer drain", () => {
  it("runs the uploaded native Node helper with traced pg and canonical TLS tooling", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rivalhub-drain-cli-"));
    try {
      for (const file of ["scripts/standby/production-quiescence.mjs", "src/db/supabase-ca.ts"]) {
        writeFileSync(join(dir, file.split("/").at(-1)!), readFileSync(file));
      }
      writeFileSync(join(dir, "postgres-connection.ts"), readFileSync("src/db/postgres-connection.ts", "utf8")
        .replace('from "./supabase-ca"', 'from "./supabase-ca.ts"'));
      const run = promisify(execFile);
      const result = await run(process.execPath, [join(dir, "production-quiescence.mjs"), process.cwd()], {
        env: { NODE_ENV: "test", DATABASE_URL: localDatabaseUrl() }, timeout: 10_000,
      });
      expect(result.stdout).toContain("two server observations");
      await expect(run(process.execPath, [join(dir, "production-quiescence.mjs"), process.cwd()], {
        env: { NODE_ENV: "test", DATABASE_URL: "postgresql://user:do-not-log-this@invalid.invalid/db" }, timeout: 10_000,
      })).rejects.toMatchObject({ stderr: expect.not.stringContaining("do-not-log-this") });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("waits for real idle and aborted transactions, then requires two empty observations", async () => {
    const pool = createLocalPool({ max: 2 });
    const observer = await pool.connect(), writer = await pool.connect();
    try {
      for (const aborted of [false, true]) {
        await writer.query("BEGIN");
        if (aborted) await expect(writer.query("SELECT 1 / 0")).rejects.toMatchObject({ code: "22012" });
        else await writer.query("SELECT 1");
        let observations = 0;
        const client = { query: async (sql: string) => {
          const state = await observer.query(sql);
          observations++;
          if (observations === 1) {
            expect(state.rows[0].transactions).toBeGreaterThan(0);
            await writer.query("ROLLBACK");
          }
          return state;
        } };
        await waitForDatabaseQuiescence(client, { intervalMs: 1 });
        expect(observations).toBe(3);
      }
    } finally {
      await writer.query("ROLLBACK");
      writer.release(); observer.release(); await pool.end();
    }
  });

  it("fails closed while a real transaction remains open", async () => {
    const pool = createLocalPool({ max: 2 });
    const observer = await pool.connect(), writer = await pool.connect();
    try {
      await writer.query("BEGIN");
      await writer.query("SELECT 1");
      await expect(waitForDatabaseQuiescence(observer, { timeoutMs: 10, intervalMs: 1 })).rejects.toThrow("did not drain");
      expect((await observer.query(quiescenceSql)).rows[0].transactions).toBeGreaterThan(0);
    } finally {
      await writer.query("ROLLBACK");
      writer.release(); observer.release(); await pool.end();
    }
  });
});
