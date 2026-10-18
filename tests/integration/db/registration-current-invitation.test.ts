import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { currentRosterParticipantStatus } from "../../../src/lib/competition-entries/participant-context";
import { createLocalPool } from "./harness/database";

// Protects the real correlated query against old invitations surviving a revision change.
it("only advertises invitations in the current roster while preserving historical confirmed participation", async () => {
  const pool = createLocalPool();
  const client = await pool.connect();
  const db = drizzle(client, { schema });
  const [user, season, entry, revision, nextRevision, participant] = Array.from({ length: 6 }, () => randomUUID());
  try {
    await client.query("BEGIN");
    await db.insert(schema.users).values({ id: user, email: `${user}@local.test` });
    await db.insert(schema.seasons).values({ id: season, slug: season, name: "Invitation revision", kind: "custom", registrationMode: "team", status: "registration" });
    await db.insert(schema.competitionEntries).values({ id: entry, competitionId: season, source: "event_native", name: "Invitation team", representativeUserId: user, registrationStatus: "draft", currentRosterRevisionId: revision });
    await db.insert(schema.competitionEntryRosterRevisions).values([
      { id: revision, entryId: entry, revisionNumber: 1, status: "draft", createdBy: user },
      { id: nextRevision, entryId: entry, revisionNumber: 2, status: "draft", createdBy: user },
    ]);
    await db.insert(schema.competitionEntryParticipants).values({ id: participant, entryId: entry, userId: user, status: "invited", invitedByUserId: user });
    await db.insert(schema.competitionEntryRosterMembers).values({ revisionId: revision, participantId: participant, userId: user, isPrimaryStarter: true });
    const read = async () => (await db.select({ status: currentRosterParticipantStatus() })
      .from(schema.competitionEntries).innerJoin(schema.competitionEntryParticipants, eq(schema.competitionEntryParticipants.entryId, schema.competitionEntries.id))
      .where(eq(schema.competitionEntries.id, entry)))[0]?.status;
    expect(await read()).toBe("invited");
    await db.update(schema.competitionEntries).set({ currentRosterRevisionId: nextRevision }).where(eq(schema.competitionEntries.id, entry));
    expect(await read()).toBeNull();
    expect((await db.query.competitionEntryParticipants.findFirst({ where: eq(schema.competitionEntryParticipants.id, participant) }))?.status).toBe("invited");
    await db.update(schema.competitionEntryParticipants).set({ status: "confirmed", confirmedAt: new Date() }).where(eq(schema.competitionEntryParticipants.id, participant));
    expect(await read()).toBe("confirmed");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
