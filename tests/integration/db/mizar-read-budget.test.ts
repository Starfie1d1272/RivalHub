import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { mizarInstallations } from "@/db/schema";
import { hashCredential } from "@/lib/mizar/installation";
import { loadMizarMatchDocument } from "@/lib/mizar/context";
import { getReadBudgetSnapshot } from "@/lib/observability/read-budget";
import { GET } from "@/app/api/mizar/[operation]/route";
import { seedFixture, NOW } from "./harness/mizar";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), cacheLife: vi.fn(), cacheTag: vi.fn() }));

it("keeps real GET outcomes, provider build attempts and encoded body bytes as separate denominators", async () => {
  const f = await seedFixture();
  const credential = `rh_mizar_${randomUUID()}_${"b".repeat(64)}`;
  await db.update(mizarInstallations).set({ credentialHash: hashCredential(credential) }).where(eq(mizarInstallations.id, f.installationId));
  const before = getReadBudgetSnapshot();
  const request = (operation: string, query: string, etag?: string, authorized = true) => GET(
    new Request(`http://localhost/api/mizar/${operation}?${query}`, { headers: {
      ...(authorized ? { authorization: `Bearer ${credential}` } : {}), ...(etag ? { "if-none-match": etag } : {}),
    } }), { params: Promise.resolve({ operation }) });
  const first = await request("match", `matchId=${f.matchId}`);
  expect(first.status).toBe(200);
  const bytes = (await first.arrayBuffer()).byteLength;
  const unchanged = await request("match", `matchId=${f.matchId}`, first.headers.get("etag")!);
  expect(unchanged.status).toBe(304);
  expect((await unchanged.arrayBuffer()).byteLength).toBe(0);
  expect((await request("match", `matchId=${randomUUID()}`)).status).toBe(404);
  expect((await request("match", `matchId=${f.matchId}`, undefined, false)).status).toBe(403);
  // Internal consumers also build documents, without adding an HTTP request.
  await loadMizarMatchDocument(f.matchId, f.seasonId);
  const from = new Date(NOW.getTime() - 86400_000).toISOString(), to = new Date(NOW.getTime() + 86400_000).toISOString();
  const schedule = await request("schedule", `from=${from}&to=${to}`);
  expect(schedule.status).toBe(200);
  const scheduleBytes = (await schedule.arrayBuffer()).byteLength;
  expect((await request("schedule", "from=invalid&to=invalid")).status).toBe(400);
  const after = getReadBudgetSnapshot();
  const matchBefore = before.mizar[0], scheduleBefore = before.mizar[1];
  expect(after.mizar[0]).toMatchObject({ requests: matchBefore.requests + 4, status200: matchBefore.status200 + 1,
    status304: matchBefore.status304 + 1, failures: matchBefore.failures + 2, fullBuilds: matchBefore.fullBuilds + 4,
    encodedResponses: matchBefore.encodedResponses + 2, encodedBodyBytes: matchBefore.encodedBodyBytes + bytes });
  expect(after.mizar[1]).toMatchObject({ requests: scheduleBefore.requests + 2, status200: scheduleBefore.status200 + 1,
    failures: scheduleBefore.failures + 1, fullBuilds: scheduleBefore.fullBuilds + 1,
    encodedResponses: scheduleBefore.encodedResponses + 1, encodedBodyBytes: scheduleBefore.encodedBodyBytes + scheduleBytes });
  expect(Object.keys(after.mizar[0]).sort()).toEqual(["encodedBodyBytes", "encodedResponses", "failures", "family", "fullBuilds", "other", "requests", "status200", "status304"].sort());
});
