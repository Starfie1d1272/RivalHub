import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { readAdminPostMatchTasks } from "@/lib/admin/matches/postmatch-tasks";
import { readReopenedPostMatchIds } from "@/lib/postmatch/read";
import { addMatchCommentatorInTx, revokePostMatchSubmissionInTx, setMatchVideoUrlInTx, submitPostMatchReportInTx } from "@/lib/postmatch/service";
import { seedFixture } from "./harness/mizar";

it("reads recording and reopened confirmation tasks through the real owners without OCR", async () => {
  const f = await seedFixture();
  const [entry] = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, f.entryAId));
  const caster = entry!.representativeUserId!;
  const [otherEntry] = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, f.entryBId));
  const superAdmin = otherEntry!.representativeUserId!;
  await db.update(schema.users).set({ role: "super_admin" }).where(eq(schema.users.id, superAdmin));
  await db.insert(schema.seasonAdminGrants).values({ seasonId: f.seasonId, userId: caster });
  await db.transaction(tx => addMatchCommentatorInTx(tx, { matchId: f.matchId, userId: caster, actorId: caster }));
  await db.update(schema.matches).set({ status: "finished", scoreA: 2, scoreB: 0, completedAt: new Date() }).where(eq(schema.matches.id, f.matchId));
  const read = async () => {
    const rows = await readAdminPostMatchTasks(db, f.seasonId, caster, { matchIds: [f.matchId] });
    return rows.flatMap(row => row.tasks.filter(task => task.anchor === "match-workbench-finished-postmatch").map(task => task.label));
  };
  expect(await readReopenedPostMatchIds(db, [f.matchId])).toEqual(new Set());
  expect(await read()).toEqual(["登记解说回放"]);
  await db.transaction(tx => setMatchVideoUrlInTx(tx, { matchId: f.matchId, videoUrl: "https://video.example/isolated", actorId: caster }));
  // No report and no reopen is valid; absence alone must not invent a confirmation task.
  expect(await read()).toEqual([]);
  await db.transaction(tx => revokePostMatchSubmissionInTx(tx, { matchId: f.matchId, actorId: superAdmin }));
  expect(await readReopenedPostMatchIds(db, [f.matchId])).toEqual(new Set([f.matchId]));
  expect(await read()).toEqual(["确认更正后的解说名单"]);
  // #1129 / migration 0099: the real super-admin can confirm without joining the roster.
  await db.transaction(tx => submitPostMatchReportInTx(tx, { matchId: f.matchId, actorId: superAdmin }));
  expect(await readReopenedPostMatchIds(db, [f.matchId])).toEqual(new Set());
  expect(await read()).toEqual([]);
  expect((await db.select().from(schema.matchCommentators).where(eq(schema.matchCommentators.matchId, f.matchId))).map(row => row.userId)).toEqual([caster]);
  expect(await readAdminPostMatchTasks(db, f.seasonId, caster, { matchIds: [] })).toEqual([]);
});
