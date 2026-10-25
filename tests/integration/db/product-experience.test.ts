/** Real PostgreSQL protects UNION/grouping-set denominators, timezone and official
 * scope. Mocked SQL cannot prove NULL/timestamp behavior or the canonical tasks. */
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { db } from "@/db/client";
import * as s from "@/db/schema";
import { readWorkflowMetrics } from "@/lib/admin/product-experience/read";
import { seedFixture } from "./harness/mizar";

it("aggregates actual submissions and proposal outcomes, excludes rehearsals and retains missing-time boundaries", async () => {
  const real = await seedFixture();
  const rehearsal = await seedFixture({ isTest: true });
  const now = new Date("2096-10-25T05:00:00Z");
  const start = new Date("2096-10-24T17:00:00Z"); // Beijing Oct 25
  const end = new Date(start.getTime() + 60000);
  const entry = (await db.query.competitionEntries.findFirst({ where: eq(s.competitionEntries.id, real.entryAId) }))!;
  await db.insert(s.competitionEntrySubmissions).values([
    { entryId: entry.id, rosterRevisionId: entry.currentRosterRevisionId!, sequence: 1, submittedBy: entry.representativeUserId, submittedAt: start, decision: "approved", decidedAt: end },
    { entryId: entry.id, rosterRevisionId: entry.currentRosterRevisionId!, sequence: 2, submittedBy: entry.representativeUserId, submittedAt: start },
  ]);
  await db.insert(s.matchTimeProposals).values([
    { matchId: real.matchId, proposedBy: entry.representativeUserId, proposedTime: now, createdAt: start, status: "accepted", responseAt: end, resolution: "auto_timeout" },
    { matchId: real.matchId, proposedBy: entry.representativeUserId, proposedTime: now, createdAt: start, status: "expired" },
    { matchId: real.matchId, proposedBy: entry.representativeUserId, proposedTime: now, createdAt: start },
    { matchId: rehearsal.matchId, proposedBy: entry.representativeUserId, proposedTime: now, createdAt: start, status: "accepted", responseAt: end },
  ]);
  await db.update(s.matchVetoSessions).set({ startedAt: start, completedAt: end }).where(eq(s.matchVetoSessions.matchId, real.matchId));
  await db.update(s.matchVetoSessions).set({ startedAt: start, completedAt: end }).where(eq(s.matchVetoSessions.matchId, rehearsal.matchId));
  await db.update(s.matches).set({ status: "finished", completedAt: end }).where(eq(s.matches.id, real.matchId));
  await db.update(s.matches).set({ status: "finished", completedAt: end }).where(eq(s.matches.id, rehearsal.matchId));
  const [institution] = await db.insert(s.institutions).values({ name: "Workflow fixture", source: "manual", sourceVersion: "test" }).returning();
  await db.insert(s.educationVerifications).values([
    { userId: entry.representativeUserId, institutionId: institution.id, academicStatus: "enrolled", evidenceType: "institutional_email", status: "rejected", submittedAt: start, reviewedAt: end },
    { userId: entry.representativeUserId, institutionId: institution.id, academicStatus: "enrolled", evidenceType: "institutional_email", status: "pending", submittedAt: start },
  ]);
  const all = await readWorkflowMetrics(db, { days: "7", eventId: "" }, now);
  expect(all.rows.find(r => r.key === "registration")).toMatchObject({ started: 2, resolved: 1, waiting: 1, approved: 1, p50: 60000 });
  expect(all.rows.find(r => r.key === "education")).toMatchObject({ started: 2, resolved: 1, waiting: 1, approved: 0 });
  expect(all.rows.find(r => r.key === "scheduling")).toMatchObject({ started: 3, resolved: 2, waiting: 1, approved: 1, missingTiming: 1, p50: 60000, p90: 60000 });
  expect(all.rows.find(r => r.key === "veto")).toMatchObject({ started: 1, resolved: 1, p50: 60000, trend: [expect.objectContaining({ day: "2096-10-25", started: 1 })] });
  expect(all.postmatch).toMatchObject({ finished: 1, pending: 1, ready: 0, reopened: 0 });
  const scoped = await readWorkflowMetrics(db, { days: "7", eventId: rehearsal.seasonId }, now);
  expect(scoped.rows.some(r => r.key === "education")).toBe(false);
  expect(scoped.rows.every(r => r.started === 0)).toBe(true);
  expect(scoped.postmatch.finished).toBe(0);
  expect(JSON.stringify(all)).not.toContain(entry.representativeUserId);
  await db.insert(s.auditLogs).values({ seasonId: real.seasonId, action: "postmatch.report.revoke", targetId: real.matchId });
  expect((await readWorkflowMetrics(db, { days: "7", eventId: real.seasonId }, now)).postmatch.reopened).toBe(1);
  await db.insert(s.seasonAdminGrants).values({ seasonId: real.seasonId, userId: entry.representativeUserId });
  await db.insert(s.matchCommentators).values({ matchId: real.matchId, userId: entry.representativeUserId, addedByUserId: entry.representativeUserId });
  await db.insert(s.postMatchReports).values({ matchId: real.matchId, submittedByUserId: entry.representativeUserId });
  expect((await readWorkflowMetrics(db, { days: "7", eventId: real.seasonId }, now)).postmatch.reopened).toBe(0);
  await db.update(s.matches).set({ completedAt: null }).where(eq(s.matches.id, real.matchId));
  expect((await readWorkflowMetrics(db, { days: "7", eventId: real.seasonId }, now)).postmatch).toMatchObject({ finished: 0, missingCompletionTime: 1 });
});
