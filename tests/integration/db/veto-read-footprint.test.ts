import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { projectVetoRoomView } from "@/lib/matches/veto-room/read-model";
import { readVetoRoomSnapshot, submitVetoCommand } from "@/lib/matches/veto-room/service";
import { createLocalPool, measureMaxConcurrentClientQueries } from "./harness/database";
import { seedFixture, NOW } from "./harness/mizar";

// Real PG verifies joined nullable rows/date decoding, bounded wire requests and
// side-effect-free polling; mocks cannot prove these persistence/driver contracts.
it("reads an active BP snapshot in two SELECTs without changing session or exposing appeal reasons", async () => {
  const f=await seedFixture();
  const entry=(await db.query.competitionEntries.findFirst({where:eq(schema.competitionEntries.id,f.entryAId)}))!;
  await db.update(schema.matchVetoSessions).set({completedAt:null,privilegedEntryId:f.entryAId,vetoTeamAEntryId:f.entryAId,mapPoolSnapshot:["de_ancient","de_mirage","de_nuke","de_dust2","de_inferno","de_anubis","de_train"],currentTurnKey:"ban-veto-b-opening",turnStartedAt:NOW,turnDeadlineAt:new Date(NOW.getTime()+45_000)}).where(eq(schema.matchVetoSessions.matchId,f.matchId));
  await db.insert(schema.matchVetoSteps).values({matchId:f.matchId,stepOrder:1,actionType:"ban",mapName:"de_ancient",entryId:f.entryAId,turnKey:"ban-veto-a-opening",source:"system"});
  const [incident]=await db.insert(schema.matchVetoTimeoutIncidents).values({matchId:f.matchId,turnKey:"ban-veto-a-opening",entryId:f.entryAId,representativeUserId:entry.representativeUserId,deadlineAt:NOW,resolvedAt:NOW,eligibleOptions:["de_ancient"],selectedOptions:["de_ancient"]}).returning();
  await db.insert(schema.matchVetoAppeals).values([
    {timeoutIncidentId:incident!.id,submittedBy:entry.representativeUserId,reason:"private pending reason"},
    {timeoutIncidentId:incident!.id,submittedBy:entry.representativeUserId,reason:"private historical reason",status:"rejected",resolutionScope:"participant_or_unverified",resolvedBy:entry.representativeUserId,resolvedAt:NOW,resolutionNote:"private decision"},
  ]);
  const before=await db.query.matchVetoSessions.findFirst({where:eq(schema.matchVetoSessions.matchId,f.matchId)});
  const audit=await db.select({id:schema.auditLogs.id}).from(schema.auditLogs).where(eq(schema.auditLogs.targetId,f.matchId));
  const pool=createLocalPool({max:1});const client=await pool.connect();
  const measured=drizzle(client,{schema});let selects=0;let rows=0;let jsonBytes=0;
  const query=client.query;
  client.query=((...args:unknown[])=>Promise.resolve(Reflect.apply(query,client,args)).then(result=>{
    if(result.command==="SELECT"){selects++;rows+=result.rows.length;jsonBytes+=Buffer.byteLength(JSON.stringify(result.rows));}
    return result;
  })) as typeof client.query;
  try {
    let snapshot!: Awaited<ReturnType<typeof readVetoRoomSnapshot>>;
    const concurrent=await measureMaxConcurrentClientQueries(client,async()=>{snapshot=await readVetoRoomSnapshot(f.matchId,measured);});
    expect(selects).toBe(2);expect(concurrent).toBe(1);expect(rows).toBe(3);
    expect(snapshot.steps).toHaveLength(1);expect(snapshot.incidents).toHaveLength(1);expect(snapshot.appeals).toHaveLength(2);
    expect(snapshot.steps[0]!.createdAt).toBeInstanceOf(Date);expect(snapshot.incidents[0]!.deadlineAt).toBeInstanceOf(Date);
    expect(snapshot.appeals.every(a=>a.createdAt instanceof Date)).toBe(true);
    expect(snapshot.session).toEqual(before);expect(snapshot.gameplayStarted).toBe(false);
    expect(snapshot.effectiveForceAt).toBeNull();expect(snapshot.previousMatchBlocker).toBe(false);
    const bounds=await db.execute(sql`select clock_timestamp() as now`);
    expect(snapshot.serverNow.getTime()).toBeLessThanOrEqual(new Date(bounds.rows[0]!.now as string).getTime());
    // Auth/projection may finish much later than the core snapshot.
    await db.execute(sql`select pg_sleep(0.05)`);
    const responseBoundary=await db.execute(sql`select clock_timestamp() as now`);
    const snapshotRows=rows;const snapshotBytes=jsonBytes;
    const beforeProjection=selects;
    const anonymous=await projectVetoRoomView(snapshot,null,null,measured);
    expect(selects-beforeProjection).toBe(1);
    expect(anonymous.entries.map(entry=>entry.id)).toEqual([f.entryAId,f.entryBId]);
    expect(anonymous.entries.every(entry=>typeof entry.name === "string")).toBe(true);
    const responseNow=new Date(anonymous.session.serverNow).getTime();
    expect(responseNow).toBeGreaterThan(snapshot.serverNow.getTime());
    expect(responseNow).toBeGreaterThanOrEqual(new Date(responseBoundary.rows[0]!.now as string).getTime());
    expect(JSON.stringify(anonymous)).not.toContain("private");
    expect(anonymous.permissions.canOperateCurrentTurn).toBe(false);expect(anonymous.permissions.canRewind).toBe(false);
    const admin=await projectVetoRoomView(snapshot,entry.representativeUserId,{userId:entry.representativeUserId,email:"fixture@local.test",role:"super_admin",seasonIds:[]});
    expect(admin.permissions.isAdmin).toBe(true);expect(JSON.stringify(admin)).toContain("private");
    await db.update(schema.matchMaps).set({startedAt:NOW}).where(eq(schema.matchMaps.id,f.mapOneId));
    expect((await readVetoRoomSnapshot(f.matchId)).gameplayStarted).toBe(true);
    expect(await db.query.matchVetoSessions.findFirst({where:eq(schema.matchVetoSessions.matchId,f.matchId)})).toEqual(before);
    expect(await db.select({id:schema.auditLogs.id}).from(schema.auditLogs).where(eq(schema.auditLogs.targetId,f.matchId))).toEqual(audit);
    console.info("VETO_READ_FOOTPRINT",JSON.stringify({snapshotSelects:2,projectionSelects:1,snapshotReturnedRows:snapshotRows,projectionReturnedRows:rows-snapshotRows,snapshotJsonBytes:snapshotBytes,projectionJsonBytes:jsonBytes-snapshotBytes,transactionMaxConcurrentQueries:concurrent}));
  } finally {client.query=query;client.release();await pool.end();}
});

it("keeps an uninitialized scheduled room read-only and derives start timing from the previous match",async()=>{
  const f=await seedFixture({matchStatus:"scheduled"});
  await db.delete(schema.matchVetoSessions).where(eq(schema.matchVetoSessions.matchId,f.matchId));
  const previous=randomUUID();
  await db.insert(schema.matches).values({id:previous,seasonId:f.seasonId,entryAId:f.entryAId,entryBId:f.entryBId,stage:"fixture-stage",format:"bo3",status:"in_progress"});
  const blocked=await readVetoRoomSnapshot(f.matchId);
  expect(blocked.session.startedAt).toBeNull();expect(blocked.steps).toEqual([]);expect(blocked.incidents).toEqual([]);expect(blocked.appeals).toEqual([]);
  expect(blocked.previousMatchBlocker).toBe(true);expect(blocked.effectiveForceAt).toBeNull();
  expect(await db.query.matchVetoSessions.findFirst({where:eq(schema.matchVetoSessions.matchId,f.matchId)})).toBeUndefined();
  const completedAt=new Date(Date.now()+60_000);
  await db.update(schema.matches).set({status:"finished",isForfeit:true,completedAt,scoreA:2,scoreB:0}).where(eq(schema.matches.id,previous));
  const ready=await readVetoRoomSnapshot(f.matchId);
  expect(ready.previousMatchBlocker).toBe(false);expect(ready.effectiveForceAt).toEqual(new Date(completedAt.getTime()+15*60_000));
  expect(await db.query.matchVetoSessions.findFirst({where:eq(schema.matchVetoSessions.matchId,f.matchId)})).toBeUndefined();
  expect(await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId,f.matchId),eq(schema.auditLogs.action,"match.veto.start")))).toEqual([]);
});

// A command holds the match lock, so its own RETURNING row can replace repeated step reads.
it("reuses locked BP steps while preserving idempotency and stale-command refusal", async () => {
  const f = await seedFixture({isTest:true});
  const match = (await db.query.matches.findFirst({where:eq(schema.matches.id,f.matchId)}))!;
  await db.update(schema.matchVetoSessions).set({completedAt:null,privilegedEntryId:f.entryAId,vetoTeamAEntryId:f.entryAId,
    mapPoolSnapshot:["de_ancient","de_mirage","de_nuke","de_dust2","de_inferno","de_anubis","de_train"],currentTurnKey:"ban-veto-a-opening",
    turnStartedAt:sql`clock_timestamp()`,turnDeadlineAt:sql`clock_timestamp() + interval '45 seconds'`}).where(eq(schema.matchVetoSessions.matchId,f.matchId));
  const before = await readVetoRoomSnapshot(f.matchId);
  const pool = createLocalPool({max:1}); const client = await pool.connect();
  let stepReads = 0;
  const measured = drizzle(client,{schema,logger:{logQuery(query){if(query.startsWith("select") && query.includes('"match_veto_steps"'))stepReads++;}}});
  const input = {matchId:f.matchId,actorId:match.testConfig!.operatorAId,expectedRevision:before.session.revision,expectedTurnKey:"ban-veto-a-opening",clientRequestId:randomUUID(),command:{kind:"step" as const,actionType:"ban" as const,mapName:"de_ancient"}};
  try {
    expect(await submitVetoCommand(input,measured)).toBe("applied");
    expect(stepReads).toBe(2);
    expect(await submitVetoCommand(input,measured)).toBe("idempotent");
    expect(await submitVetoCommand({...input,clientRequestId:randomUUID()},measured)).toBe("stale");
    const after = await readVetoRoomSnapshot(f.matchId);
    expect(after.steps).toHaveLength(1);expect(after.steps[0]).toMatchObject({mapName:"de_ancient",source:"participant"});
    expect(after.currentTurn?.key).toBe("ban-veto-b-opening");
    expect(await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId,f.matchId),eq(schema.auditLogs.action,"match.veto.step")))).toHaveLength(1);
  } finally {client.release();await pool.end();}
});
