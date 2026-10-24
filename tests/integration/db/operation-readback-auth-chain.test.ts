import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { expect, it, vi } from "vitest";

// Only the Next request transport is supplied by the fixture. Auth, iron-session,
// registry reads, user roles and grant authorization are the actual implementations.
const request = vi.hoisted(() => ({ cookies: new Map<string, string>(), queries: [] as string[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => request.cookies.has(name) ? { name, value: request.cookies.get(name)! } : undefined,
  getAll: () => [...request.cookies].map(([name, value]) => ({ name, value })),
  set: (name: string, value: string) => { request.cookies.set(name, value); },
}) }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), connection: async () => {} }));
vi.mock("next/cache", async importOriginal => ({ ...await importOriginal<typeof import("next/cache")>(), revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/db/client", async importOriginal => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@/db/schema");
  return { ...actual, db: drizzle((actual.db as typeof actual.db & { $client: Pool }).$client, {
    schema, logger: { logQuery: query => request.queries.push(query) },
  }) };
});
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { createUserSession, getUserSession, requireSeasonAdmin } from "@/lib/auth/session";
import { beginAuthentication } from "@/lib/auth/session-registry";
import { getMatchRosterReadback } from "@/actions/matches/roster";
import { getMatchRecordingReadback } from "@/actions/postmatch";
import { getTimeProposalReadback } from "@/actions/matches/scheduling";
import { seedFixture } from "./harness/mizar";
import { assertLocalDatabaseUrl, buildLocalAppEnvironment } from "../../../scripts/db/local-environment";

it("unseals a real application cookie, rechecks actual grants, and denies all three private readbacks after DB revocation", async () => {
  const databaseUrl = assertLocalDatabaseUrl(process.env.DATABASE_URL, "readback auth fixture");
  // Reuse the canonical local-only session configuration; no provider keys are needed.
  const local = buildLocalAppEnvironment({ databaseUrl, apiUrl: "http://127.0.0.1:54321", publishableKey: "", serviceRoleKey: "" });
  const fixture = await seedFixture({ matchStatus: "scheduled", unboundSource: true, freezeEventRoster: true });
  // Reuse a normal non-representative fixture participant. No password, provider
  // credential, new privileged user or persistent secret is created.
  const [actor] = await db.select({ id: schema.users.id, email: schema.users.email, role: schema.users.role })
    .from(schema.users).where(eq(schema.users.steam64, fixture.steam64[1]!));
  expect(actor?.role).toBe("user");
  if (!actor) throw new Error("fixture participant missing");
  const [entry] = await db.select({ representative: schema.competitionEntries.representativeUserId })
    .from(schema.competitionEntries).where(eq(schema.competitionEntries.id, fixture.entryAId));
  expect(actor.id).not.toBe(entry!.representative);
  const proposalId = randomUUID();
  await db.insert(schema.matchTimeProposals).values({ id: proposalId, matchId: fixture.matchId,
    proposedBy: entry!.representative, proposedByEntryId: fixture.entryAId, proposedTime: new Date(Date.now() + 86400000) });
  await db.update(schema.matches).set({ recordings: [{ id: randomUUID(), commentatorUserId: actor.id,
    title: "Private fixture recording", url: "https://example.test/fixture-recording" }] }).where(eq(schema.matches.id, fixture.matchId));
  await db.insert(schema.seasonAdminGrants).values({ userId: actor.id, seasonId: fixture.seasonId });
  const auditBefore = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.seasonId, fixture.seasonId));
  vi.stubEnv("ADMIN_SESSION_SECRET", local.ADMIN_SESSION_SECRET!);
  try {
    await createUserSession({ userId: actor.id, email: actor.email }, await beginAuthentication(db));
    const sealed = request.cookies.get("rivalhub-session");
    expect(sealed).toBeTruthy();
    expect(sealed).not.toContain(actor.email);
    expect(await getUserSession()).toEqual({ userId: actor.id, email: actor.email });
    expect(await requireSeasonAdmin(fixture.seasonId)).toMatchObject({ userId: actor.id, role: "user", seasonIds: [fixture.seasonId] });

    const roster = () => getMatchRosterReadback(fixture.matchId, fixture.entryAId);
    const recording = () => getMatchRecordingReadback(fixture.matchId);
    const proposal = () => getTimeProposalReadback(proposalId);
    for (const read of [roster, recording, proposal]) expect(await read()).toMatchObject({ success: true });

    // Actual grant deletion, not a boolean auth mock. Keep the same signed cookie
    // and active application session to isolate authorization revocation.
    await db.delete(schema.seasonAdminGrants).where(and(eq(schema.seasonAdminGrants.userId, actor.id), eq(schema.seasonAdminGrants.seasonId, fixture.seasonId)));
    for (const read of [roster, recording, proposal]) {
      request.queries = [];
      expect(await read()).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
      expect(request.queries.some(query => query.includes('"application_sessions"'))).toBe(true);
      expect(request.queries.some(query => query.includes('"season_admin_grants"'))).toBe(true);
      expect(request.queries.some(query => query.includes('"match_roster_players"') || query.includes('"recordings"') || query.includes('"proposed_time"') || query.includes('"resolution"'))).toBe(false);
    }
    expect(await getUserSession()).toEqual({ userId: actor.id, email: actor.email });
    expect(request.cookies.get("rivalhub-session")).toBe(sealed);

    // Restoring the grant proves the failures were scoped permission denials,
    // rather than an invalid fixture cookie or a stopped database read.
    await db.insert(schema.seasonAdminGrants).values({ userId: actor.id, seasonId: fixture.seasonId });
    for (const read of [roster, recording, proposal]) expect(await read()).toMatchObject({ success: true });

    // Registry revocation must also defeat the still-present signed cookie.
    await db.delete(schema.applicationSessions).where(eq(schema.applicationSessions.userId, actor.id));
    expect(request.cookies.get("rivalhub-session")).toBe(sealed);
    for (const read of [roster, recording, proposal]) {
      request.queries = [];
      expect(await read()).toMatchObject({ success: false, error: { code: "UNAUTHORIZED" } });
      expect(request.queries.some(query => query.includes('"match_roster_players"') || query.includes('"recordings"') || query.includes('"proposed_time"') || query.includes('"resolution"'))).toBe(false);
    }
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.seasonId, fixture.seasonId))).toEqual(auditBefore);
  } finally { request.cookies.clear(); vi.unstubAllEnvs(); }
});
