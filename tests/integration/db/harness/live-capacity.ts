import { createHash } from "node:crypto";
import { cpus, totalmem, platform, arch } from "node:os";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, vi } from "vitest";
import { createLocalPool } from "./database";
import { seedFixture, type Fixture } from "./mizar";

const measured = vi.hoisted(() => ({ transactions: [] as number[] }));

// Real PostgreSQL with production's three-connection pool; only Next cache hooks
// are stubbed. The real SDK sends HTTP to a loopback fault injector.
vi.mock("@/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@/db/schema");
  const { createLocalPool } = await import("./database");
  const realDb = drizzle(
    createLocalPool({ max: 3, connectionTimeoutMillis: 10000 }),
    { schema },
  );
  const transaction = realDb.transaction.bind(realDb);
  realDb.transaction = async (work, config) => {
    let began = 0;
    try {
      return await transaction((tx) => {
        began = performance.now();
        return work(tx);
      }, config);
    } finally {
      if (began) measured.transactions.push(performance.now() - began);
    }
  };
  return { db: realDb };
});
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { POST } from "@/app/api/mizar/[operation]/route";
import {
  hashCredential,
  revokeMizarInstallation,
} from "@/lib/mizar/installation";
import { ingestMizarReliable } from "@/lib/mizar/reliable";
import { RELIABLE_EVENT_SCHEMA_VERSION } from "@/lib/mizar/protocol";
import { ingestMizarLive } from "@/lib/mizar/live";
import { claimMizarSource, takeOverCurrentMap } from "@/lib/mizar/source";
import { loadMizarMatchDocumentInTx } from "@/lib/mizar/context";
import { recordCanonicalMapResultInTx } from "@/lib/matches/results";

const baseline = process.env.LIVE_CAPACITY_BASELINE === "1";
const fixtureWire = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/contracts/mizar-live-snapshot-v1.radar.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const pool = (db as typeof db & { $client: ReturnType<typeof createLocalPool> })
  .$client;
const monitor = createLocalPool({ max: 1 });
const state: { mode: "fast" | "slow" | "timeout" | "disconnect" | "429" | "invalid-body" | "stalled-body" ; sendBarrier?: Promise<void>; sent: number; bytes: number; activeHttp: number; maxHttp: number } = { mode: "fast", sent: 0, bytes: 0, activeHttp: 0, maxHttp: 0 };
const publications: Array<{ at: number; payload: Record<string, unknown> }> =
  [];
const server = createServer(async (req, res) => {
  const current = state.mode;
  const sendBarrier = state.sendBarrier;
  let body = "";
  for await (const chunk of req) body += chunk.toString();
  state.sent++;
  state.bytes += Buffer.byteLength(body);
  state.activeHttp++;
  state.maxHttp = Math.max(state.maxHttp, state.activeHttp);
  res.on("close", () => {
    state.activeHttp--;
  });
  expect(req.url).toContain("private=true");
  const payload = JSON.parse(body);
  publications.push({ at: performance.now(), payload });
  if (current === "disconnect") {
    res.destroy();
    return;
  }
  if (current === "stalled-body") {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.write('{"error":"');
    await delay(2600);
    res.end('slow"}');
    return;
  }
  if (sendBarrier) await sendBarrier;
  await delay(current === "slow" ? 700 : current === "timeout" ? 2600 : 5);
  res.writeHead(current === "429" || current === "invalid-body" ? 429 : 202, {
    "Content-Type": "application/json",
  });
  res.end(current === "invalid-body" ? "not-json" : current === "429" ? '{"error":"quota"}' : "{}");
});
function snapshot(f: Fixture, seq = 1, producedAt = new Date().toISOString()) {
  return {
    ...fixtureWire,
    matchId: f.matchId,
    competitionId: f.seasonId,
    format: "bo3",
    producedAt,
    capability: { ...fixtureWire.capability, lineupComplete: true },
    cursor: {
      ...fixtureWire.cursor,
      producerInstanceId: f.producerInstanceId,
      liveSessionId: f.liveSessionId,
      programSourceGeneration: 0,
      mapEpoch: 1,
      runtimeSeq: seq,
    },
    players: Array.from({ length: 10 }, (_, i) => ({
      sourcePlayerId: `source-${i}`,
      canonicalPlayerId: `player-${i}`,
      identityEvidence: "canonical",
      lineupEvidence: "current",
      displayName: `测试选手 ${i}`,
      side: i < 5 ? "CT" : "T",
      lifeState: "alive",
      health: 100,
      armor: 100,
      hasHelmet: true,
      hasDefuser: i < 5,
      money: 3500,
      equipmentValue: 5000,
      activeWeapon: { name: "weapon_ak47", ammoClip: 30, ammoReserve: 90 },
      stats: {
        kills: 10,
        assists: 2,
        deaths: 6,
        liveAdr: 82.5,
        completedAdr: 80,
      },
    })),
    radar: {
      ...fixtureWire.radar,
      players: Array.from({ length: 10 }, (_, i) => ({
        ...fixtureWire.radar.players[0],
        sourcePlayerId: `source-${i}`,
        canonicalPlayerId: `player-${i}`,
        side: i < 5 ? "CT" : "T",
      })),
    },
    roundHistory: {
      mapOrder: 1,
      completeness: "complete",
      rounds: Array.from({ length: 24 }, (_, i) => ({
        roundNumber: i + 1,
        winnerSide: i % 2 ? "T" : "CT",
        winnerEntryId: i % 2 ? f.entryBId : f.entryAId,
        winCondition: "elimination",
      })),
    },
    teams: {
      ct: { entryId: f.entryAId, name: "A" },
      t: { entryId: f.entryBId, name: "B" },
    },
  };
}
async function prepared() {
  const f = await seedFixture();
  const token = `rh_mizar_${f.installationId}_${"a".repeat(64)}`;
  await db
    .update(schema.mizarInstallations)
    .set({ credentialHash: hashCredential(token) })
    .where(eq(schema.mizarInstallations.id, f.installationId));
  return { ...f, token };
}
async function upload(f: Awaited<ReturnType<typeof prepared>>, seq: number) {
  return POST(
    new Request("http://local.test/api/mizar/live", {
      method: "POST",
      headers: {
        authorization: `Bearer ${f.token}`,
        "x-rivalhub-authority": "1",
        "content-type": "application/json",
      },
      body: JSON.stringify(snapshot(f, seq)),
    }),
    { params: Promise.resolve({ operation: "live" }) },
  );
}
function summary(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: s[Math.floor(s.length * 0.5)] ?? 0,
    p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] ?? 0,
    max: s.at(-1) ?? 0,
  };
}
const reports: unknown[] = [];
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("loopback listener missing");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `http://127.0.0.1:${address.port}`);
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_local-fault-injector-key");
});
afterAll(async () => {
  if (process.env.LIVE_CAPACITY_REPORT)
    writeFileSync(
      process.env.LIVE_CAPACITY_REPORT,
      JSON.stringify(
        {
          sha: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
          baseline,
          node: process.version,
          platform: platform(),
          arch: arch(),
          cpus: cpus().length,
          hostMemoryBytes: totalmem(),
          poolMax: 3,
          sourceSha256: Object.fromEntries(
            [
              "src/lib/mizar/live.ts",
              "src/lib/mizar/installation.ts",
              "src/lib/mizar/http.ts",
              "src/lib/mizar/live-admission.ts",
              "src/lib/mizar/live-broadcast.ts",
              "src/lib/auth/supabase-server.ts",
              "src/app/api/mizar/[operation]/route.ts",
              "tests/integration/db/mizar-live-correctness.test.ts",
              "tests/integration/db/harness/live-capacity.ts",
              "tests/experiments/mizar-live-capacity.test.ts",
              "tests/integration/db/harness/mizar.ts",
            ]
              .filter(existsSync)
              .map((path) => [
                path,
                createHash("sha256").update(readFileSync(path)).digest("hex"),
              ]),
          ),
          reports,
        },
        null,
        2,
      ),
    );
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await monitor.end();
  await pool.end();
});
export { state, measured, pool, monitor, publications, snapshot, prepared, upload, summary, reports, baseline };
// Export a concrete harness value. Vitest's import rewriting must not turn
// imported production bindings into undefined indirect re-exports.
export const api = { db, schema, POST, ingestMizarLive, ingestMizarReliable, RELIABLE_EVENT_SCHEMA_VERSION, revokeMizarInstallation, claimMizarSource, takeOverCurrentMap, loadMizarMatchDocumentInTx, recordCanonicalMapResultInTx };
