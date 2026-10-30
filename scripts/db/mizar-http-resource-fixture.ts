/** Disposable loopback fixture. Credentials go only to a private manifest. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import { assertDeclaredDatabaseTarget, assertLocalDatabaseUrl } from "./local-environment";
import type { Fixture } from "../../tests/integration/db/harness/mizar";
import { mizarSnapshot } from "../../tests/integration/db/harness/mizar-snapshot";

const VERSION = "rivalhub.local-mizar-http-resource.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const [command, rawPath, option] = process.argv.slice(2);
const manifestPath = resolve(rawPath ?? ".agent-tmp/mizar-http-resource.json");
type Producer = {
  label: string; fixture: Fixture; credential: string; localUserIds: string[];
  liveTemplate: ReturnType<typeof mizarSnapshot>;
  reliableEnvelope: { event: unknown; lineupSteam64: string[] };
};
type Manifest = { schemaVersion: typeof VERSION; fixtureId: string; createdAt: string; expiresAt: string;
  databaseFingerprint: string; differentMatches: true; credentialLifetime: string; producers: Producer[] };
class FixtureError extends Error { constructor(readonly reason: string) { super(reason); } }
function fail(reason: string): never { throw new FixtureError(reason); }
function privateFile(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 || stat.size > 2_000_000) fail("PRIVATE_MANIFEST_REQUIRED");
}
type CleanupManifest = Omit<Manifest, "producers"> & { producers: Array<Pick<Producer, "label" | "fixture" | "localUserIds">> };
function save(manifest: Manifest | CleanupManifest, create = false) {
  if (!create) privateFile(manifestPath);
  const fd = openSync(manifestPath, constants.O_WRONLY | constants.O_NOFOLLOW | (create ? constants.O_CREAT | constants.O_EXCL : constants.O_TRUNC), 0o600);
  try { writeFileSync(fd, JSON.stringify(manifest, null, 2) + "\n"); } finally { closeSync(fd); }
}
function read(fingerprint: string): Manifest {
  privateFile(manifestPath);
  const value = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  if (value.schemaVersion !== VERSION || !UUID.test(value.fixtureId) || value.databaseFingerprint !== fingerprint
    || !Array.isArray(value.producers) || value.producers.length > 2
    || value.producers.some((p, index) => p.label !== `producer-${index + 1}` || !p.fixture || ![p.fixture.seasonId, p.fixture.matchId, p.fixture.installationId, p.fixture.sessionId, p.fixture.entryAId, p.fixture.entryBId, p.fixture.mapOneId, p.fixture.mapTwoId].every(id => UUID.test(id)) || !Array.isArray(p.localUserIds) || p.localUserIds.length !== 10 || !p.localUserIds.every(id => UUID.test(id)))) fail("MANIFEST_TARGET_MISMATCH");
  return value;
}
async function owned(database: DB, manifest: Pick<Manifest, "fixtureId">, producer: CleanupManifest["producers"][number], index: number) {
  const [season] = await database.select({ slug: schema.seasons.slug }).from(schema.seasons).where(eq(schema.seasons.id, producer.fixture.seasonId));
  if (!season) return false;
  if (season.slug !== `mizar-http-${manifest.fixtureId}-${index + 1}`) fail("FIXTURE_OWNERSHIP_MISMATCH");
  const [match] = await database.select({ seasonId: schema.matches.seasonId, testConfig: schema.matches.testConfig }).from(schema.matches).where(eq(schema.matches.id, producer.fixture.matchId));
  if (!match || match.seasonId !== producer.fixture.seasonId || !match.testConfig) fail("FIXTURE_MATCH_MISMATCH");
  return true;
}
async function cleanup(database: DB, manifest: CleanupManifest) {
  for (const [index, p] of manifest.producers.entries()) {
    if (!await owned(database, manifest, p, index)) continue;
    const f = p.fixture;
    const participants = await database.select({ userId: schema.competitionEntryParticipants.userId }).from(schema.competitionEntryParticipants).where(inArray(schema.competitionEntryParticipants.entryId, [f.entryAId, f.entryBId]));
    if (participants.length !== p.localUserIds.length || participants.some(row => !p.localUserIds.includes(row.userId))) fail("FIXTURE_USER_SCOPE_MISMATCH");
    const users = await database.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, p.localUserIds));
    if (users.some(user => user.email !== `${user.id}@local.test`)) fail("FIXTURE_USER_MISMATCH");
    await database.transaction(async tx => {
      // Only the marked history in this owned fixture season is removed.
      const history = await tx.select({ id: schema.matches.id }).from(schema.matches).where(and(eq(schema.matches.seasonId, f.seasonId), eq(schema.matches.stage, "mizar-stats-fixture")));
      const historyIds = history.map(row => row.id);
      if (historyIds.length) {
        await tx.delete(schema.matchPlayerStats).where(inArray(schema.matchPlayerStats.matchId, historyIds));
        await tx.delete(schema.matchRosters).where(inArray(schema.matchRosters.matchId, historyIds));
        await tx.delete(schema.matchMaps).where(inArray(schema.matchMaps.matchId, historyIds));
        await tx.delete(schema.matches).where(inArray(schema.matches.id, historyIds));
      }
      // Only tagged, synthetic local fixture facts; same teardown boundary as existing fixtures.
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      const sources = await tx.select({ id: schema.matchLiveSessions.id }).from(schema.matchLiveSessions).where(eq(schema.matchLiveSessions.matchId, f.matchId));
      const sourceIds = sources.map(row => row.id);
      if (sourceIds.length) await tx.delete(schema.mizarReliableReceipts).where(inArray(schema.mizarReliableReceipts.sessionId, sourceIds));
      await tx.delete(schema.matchLiveSessions).where(eq(schema.matchLiveSessions.matchId, f.matchId));
      await tx.execute(sql`DELETE FROM match_roster_players WHERE roster_id IN (SELECT id FROM match_rosters WHERE match_id=${f.matchId})`);
      await tx.delete(schema.matchRosters).where(eq(schema.matchRosters.matchId, f.matchId));
      await tx.execute(sql`DELETE FROM match_veto_appeals WHERE timeout_incident_id IN (SELECT id FROM match_veto_timeout_incidents WHERE match_id=${f.matchId})`);
      await tx.delete(schema.matchVetoTimeoutIncidents).where(eq(schema.matchVetoTimeoutIncidents.matchId, f.matchId));
      await tx.delete(schema.matchVetoSteps).where(eq(schema.matchVetoSteps.matchId, f.matchId));
      await tx.delete(schema.matchVetoInvalidations).where(eq(schema.matchVetoInvalidations.matchId, f.matchId));
      await tx.delete(schema.matchVetoSessions).where(eq(schema.matchVetoSessions.matchId, f.matchId));
      await tx.delete(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.matchId));
      await tx.delete(schema.matches).where(eq(schema.matches.id, f.matchId));
      await tx.delete(schema.mizarInstallations).where(eq(schema.mizarInstallations.competitionId, f.seasonId));
      await tx.delete(schema.mizarPairingIntents).where(eq(schema.mizarPairingIntents.competitionId, f.seasonId));
      const entryIds = [f.entryAId, f.entryBId];
      await tx.execute(sql`DELETE FROM event_roster_members WHERE event_roster_id IN (SELECT id FROM event_rosters WHERE entry_id IN (${f.entryAId},${f.entryBId}))`);
      await tx.delete(schema.eventRosters).where(inArray(schema.eventRosters.entryId, entryIds));
      await tx.execute(sql`DELETE FROM competition_entry_roster_members WHERE revision_id IN (SELECT id FROM competition_entry_roster_revisions WHERE entry_id IN (${f.entryAId},${f.entryBId}))`);
      await tx.delete(schema.competitionEntryRosterRevisions).where(inArray(schema.competitionEntryRosterRevisions.entryId, entryIds));
      await tx.delete(schema.competitionEntryActiveClaims).where(eq(schema.competitionEntryActiveClaims.competitionId, f.seasonId));
      await tx.delete(schema.competitionEntryParticipants).where(inArray(schema.competitionEntryParticipants.entryId, entryIds));
      await tx.delete(schema.competitionEntryRepresentativeChanges).where(inArray(schema.competitionEntryRepresentativeChanges.entryId, entryIds));
      await tx.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, f.seasonId));
      await tx.delete(schema.auditLogs).where(eq(schema.auditLogs.seasonId, f.seasonId));
      await tx.delete(schema.seasons).where(eq(schema.seasons.id, f.seasonId));
      if (p.localUserIds.length) await tx.delete(schema.users).where(inArray(schema.users.id, p.localUserIds));
    });
  }
}
async function main() {
  try { assertDeclaredDatabaseTarget(process.env); assertLocalDatabaseUrl(process.env.DATABASE_URL); } catch { fail("LOCAL_DATABASE_REQUIRED"); }
  if (process.env.RIVALHUB_DB_TARGET !== "local") fail("LOCAL_TARGET_REQUIRED");
  const fingerprint = createHash("sha256").update(assertLocalDatabaseUrl(process.env.DATABASE_URL)).digest("hex");
  const { db } = await import("../../src/db/client");
  if (command === "create") {
    if (existsSync(manifestPath)) fail("MANIFEST_ALREADY_EXISTS");
    mkdirSync(dirname(manifestPath), { recursive: true, mode: 0o700 });
    const manifest: Manifest = { schemaVersion: VERSION, fixtureId: randomUUID(), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      databaseFingerprint: fingerprint, differentMatches: true,
      credentialLifetime: "Use only within this 15-minute fixture window and always cleanup in finally. Existing installation credentials have no server TTL; cleanup removes their local authority.", producers: [] };
    save(manifest, true);
    const { seedFixture, seedMizarStatsHistory } = await import("../../tests/integration/db/harness/mizar");
    const { hashCredential } = await import("../../src/lib/mizar/installation");
    const { parseLiveSnapshotV1, parseReliableEventV1, RELIABLE_EVENT_SCHEMA_VERSION } = await import("../../src/lib/mizar/protocol");
    const created: CleanupManifest["producers"] = [];
    const inject = (index: number, phase: string) => {
      if (process.env.RIVALHUB_HTTP_FIXTURE_FAIL_AT === `${index + 1}:${phase}`) fail("INJECTED_CREATE_FAILURE");
    };
    try {
      for (let index = 0; index < 2; index++) {
        const f = await seedFixture({ isTest: true, freezeEventRoster: true, seasonSlug: `mizar-http-${manifest.fixtureId}-${index + 1}` });
        // Seed commits the namespace and synthetic user identities atomically. Track
        // cleanup synchronously before any fallible parse, query, update or file I/O.
        created.push({ label: `producer-${index + 1}`, fixture: f, localUserIds: f.fixtureUserIds });
        inject(index, "seed");
        await seedMizarStatsHistory(f);
        f.producerInstanceId = `http-resource-${manifest.fixtureId}-${index + 1}`;
        f.liveSessionId = randomUUID();
        const credential = `rh_mizar_${f.installationId}_${randomBytes(32).toString("hex")}`;
        f.credentialHash = hashCredential(credential);
        const liveTemplate = mizarSnapshot(f);
        liveTemplate.map = { ...liveTemplate.map, mapId: f.mapOneId };
        const event = { schemaVersion: RELIABLE_EVENT_SCHEMA_VERSION, idempotencyKey: `resource-${manifest.fixtureId}-${index + 1}`,
          cursor: { ...liveTemplate.cursor, runtimeSeq: 1_000_000 }, observedAt: new Date().toISOString(), matchId: f.matchId, competitionId: f.seasonId,
          contextRevision: f.contextRevision, mapId: f.mapOneId, mapName: "de_nuke", entryAId: f.entryAId, entryBId: f.entryBId,
          evidence: { identity: "matched", telemetryFresh: true, contextFresh: true, source: "runtime-transition" }, kind: "map_ended", payload: { scoreA: 13, scoreB: 9, scoreCT: 4, scoreT: 9 } };
        inject(index, "parse");
        parseLiveSnapshotV1(liveTemplate); parseReliableEventV1(event);
        await db.transaction(async tx => {
          await tx.update(schema.seasons).set({ slug: `mizar-http-${manifest.fixtureId}-${index + 1}`, name: "Disposable Mizar HTTP resource fixture" }).where(eq(schema.seasons.id, f.seasonId));
          inject(index, "transaction");
          await tx.update(schema.mizarInstallations).set({ credentialHash: f.credentialHash }).where(eq(schema.mizarInstallations.id, f.installationId));
          await tx.update(schema.matchLiveSessions).set({ producerInstanceId: f.producerInstanceId, liveSessionId: f.liveSessionId }).where(eq(schema.matchLiveSessions.id, f.sessionId));
          await tx.update(schema.matchMaps).set({ mapName: "de_nuke", startedAt: new Date() }).where(eq(schema.matchMaps.id, f.mapOneId));
        });
        manifest.producers.push({ label: `producer-${index + 1}`, fixture: f, credential, localUserIds: f.fixtureUserIds, liveTemplate, reliableEnvelope: { event, lineupSteam64: [] } });
        inject(index, "save");
        save(manifest);
      }
    } catch (error) {
      try {
        await cleanup(db, { ...manifest, producers: created });
        unlinkSync(manifestPath);
      } catch {
        // Preserve a private cleanup-only manifest when teardown itself fails.
        try { save({ ...manifest, producers: created }); } catch { /* Report recovery required without printing credentials. */ }
        fail("CREATE_FAILED_CLEANUP_REQUIRED");
      }
      throw error;
    }
    console.log(JSON.stringify({ created: true, manifestPath, producers: 2, differentMatches: true, expiresAt: manifest.expiresAt }));
  } else if (command === "verify") {
    const manifest = read(fingerprint);
    if (manifest.producers.length !== 2 || manifest.producers.some(p => !p.reliableEnvelope?.event || !p.liveTemplate)) fail("PARTIAL_MANIFEST");
    const results = await db.transaction(async tx => Promise.all(manifest.producers.map(async p => {
      const key = (p.reliableEnvelope.event as { idempotencyKey: string }).idempotencyKey;
      const receipts = await tx.select({ outcome: schema.mizarReliableReceipts.outcome }).from(schema.mizarReliableReceipts).where(and(eq(schema.mizarReliableReceipts.sessionId, p.fixture.sessionId), eq(schema.mizarReliableReceipts.idempotencyKey, key)));
      const [map] = await tx.select({ scoreA: schema.matchMaps.scoreA, scoreB: schema.matchMaps.scoreB, completedAt: schema.matchMaps.completedAt }).from(schema.matchMaps).where(eq(schema.matchMaps.id, p.fixture.mapOneId));
      return { label: p.label, receiptCount: receipts.length, outcome: receipts[0]?.outcome ?? null, mapCompleted: Boolean(map?.completedAt), scoreA: map?.scoreA ?? null, scoreB: map?.scoreB ?? null };
    })), { accessMode: "read only", isolationLevel: "repeatable read" });
    console.log(JSON.stringify({ verified: true, expired: Date.now() >= Date.parse(manifest.expiresAt), results }));
    if (option === "--require-receipts" && results.some(row => row.receiptCount !== 1 || row.outcome !== "canonicalized" || !row.mapCompleted || row.scoreA !== 13 || row.scoreB !== 9)) fail("RECEIPT_NOT_CONFIRMED");
  } else if (command === "cleanup") {
    if (!existsSync(manifestPath)) { console.log(JSON.stringify({ cleaned: true, alreadyAbsent: true })); return; }
    await cleanup(db, read(fingerprint));
    unlinkSync(manifestPath);
    console.log(JSON.stringify({ cleaned: true, manifestRemoved: true }));
  } else fail("UNKNOWN_COMMAND");
}
void main().then(() => process.exit(0)).catch(error => {
  console.error(JSON.stringify({ event: "mizar.http.fixture.failed", command, reason: error instanceof FixtureError ? error.reason : "APPLICATION_FAILURE" }));
  process.exit(1);
});
