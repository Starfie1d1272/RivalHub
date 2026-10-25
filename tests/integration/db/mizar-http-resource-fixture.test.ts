import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, statSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { db } from "@/db/client";
import { seasons, users } from "@/db/schema";
import { authenticateMizar } from "@/lib/mizar/installation";
import { ingestMizarReliable } from "@/lib/mizar/reliable";
import type { Fixture } from "./harness/mizar";

const execute = promisify(execFile);
it("creates private scoped HTTP credentials, verifies receipts read-only, and removes only its synthetic facts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mizar-http-fixture-"));
  const path = join(directory, "manifest.json");
  const run = (command: string, ...args: string[]) => execute(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/db/mizar-http-resource-fixture.ts", command, path, ...args], { env: process.env, timeout: 30_000 });
  try {
    const created = await run("create");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const manifest = JSON.parse(readFileSync(path, "utf8")) as { producers: Array<{ fixture: Fixture; credential: string; localUserIds: string[]; reliableEnvelope: { event: unknown } }> };
    expect(manifest.producers).toHaveLength(2);
    expect(new Set(manifest.producers.map(p => p.fixture.matchId)).size).toBe(2);
    expect(new Set(manifest.producers.map(p => p.fixture.producerInstanceId)).size).toBe(2);
    for (const p of manifest.producers) {
      expect(created.stdout + created.stderr).not.toContain(p.credential);
      expect(await authenticateMizar(`Bearer ${p.credential}`)).toMatchObject({ id: p.fixture.installationId, competitionId: p.fixture.seasonId });
      expect(await ingestMizarReliable(p.fixture.installationId, p.fixture.seasonId, p.reliableEnvelope.event, p.fixture.authorityRevision)).toEqual({ outcome: "canonicalized", duplicate: false });
    }
    const verified = await run("verify", "--require-receipts");
    expect(verified.stdout).toContain('"receiptCount":1');
    expect((await run("verify", "--require-receipts")).stdout.trim().split("\n").at(-1)).toBe(verified.stdout.trim().split("\n").at(-1));
    chmodSync(path, 0o644);
    await expect(run("verify")).rejects.toMatchObject({ code: 1 });
    chmodSync(path, 0o600);
    await run("cleanup");
    expect(await db.select().from(seasons).where(inArray(seasons.id, manifest.producers.map(p => p.fixture.seasonId)))).toEqual([]);
    expect(await db.select().from(users).where(inArray(users.id, manifest.producers.flatMap(p => p.localUserIds)))).toEqual([]);
    expect((await run("cleanup")).stdout).toContain('"alreadyAbsent":true');
    await expect(execute(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/db/mizar-http-resource-fixture.ts", "create", path], { env: { ...process.env, RIVALHUB_DB_TARGET: "production" }, timeout: 15_000 })).rejects.toMatchObject({ code: 1 });
  } finally {
    if (statSync(directory).isDirectory()) {
      try { chmodSync(path, 0o600); await run("cleanup"); } catch { /* Preserve the original failure; disposable worker DB is dropped by the runner. */ }
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
