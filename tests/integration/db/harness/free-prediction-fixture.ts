import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { createMajorDefaultCapabilities } from "@/lib/competition/templates";
import { makeMajorRunSnapshotV4 } from "@/lib/major/run-snapshot";
import { localDatabaseUrl } from "./database";
import { withScratchDatabase,migrationFiles,replayMigration } from "./migration-replay";
export async function fixture(work:(f:{db:ReturnType<typeof drizzle<typeof schema>>;seasonId:string;userId:string;otherId:string;matchId:string;entryIds:string[]})=>Promise<void>) {
  await withScratchDatabase("free_prediction_test",async client=>{
    for(const file of migrationFiles(name=>/^\d{4}_.*\.sql$/.test(name)))await replayMigration(client,file);
    const url=new URL(localDatabaseUrl());url.pathname=`/${(await client.query("select current_database() as name")).rows[0].name}`;
    const pool=new Pool({connectionString:url.toString(),ssl:false,max:6});const db=drizzle(pool,{schema});
    const seasonId=randomUUID(),userId=randomUUID(),otherId=randomUUID();
    try {
      await db.insert(schema.users).values([userId,otherId].map(id=>({id,email:`${id}@example.test`,displayName:"观众",emailVerifiedAt:new Date(),emailVerificationSource:"admin_migration" as const})));
      const cap=createMajorDefaultCapabilities();await db.insert(schema.seasons).values({...cap,id:seasonId,slug:`bet-${seasonId}`,name:"BET 测试",kind:"Major",competitionTemplate:"major",status:"playing"});
      const entryIds:string[]=[];
      for(const name of ["银河","新星"]) {
        const entryId=randomUUID(),revisionId=randomUUID();entryIds.push(entryId);
        await db.transaction(async tx=>{await tx.insert(schema.competitionEntries).values({id:entryId,competitionId:seasonId,source:"event_native",name,representativeUserId:userId,currentRosterRevisionId:revisionId,approvedRosterRevisionId:revisionId,registrationStatus:"approved"});await tx.insert(schema.competitionEntryRepresentativeChanges).values({entryId,toUserId:userId,changedByActorId:"test"});await tx.insert(schema.competitionEntryRosterRevisions).values({id:revisionId,entryId,revisionNumber:1,status:"approved",createdBy:"test",approvedAt:new Date()});});
      }
      const [run]=await db.insert(schema.majorStageRuns).values({seasonId,stageKey:"stage1",startedBy:"test",ruleSnapshot:makeMajorRunSnapshotV4({stagePlan:cap.stagePlan.map(s=>({...s,matchFormat:s.matchFormat!,finalFormat:s.finalFormat??null})),rosterRules:{minTeamSize:5,maxTeamSize:9,starterCount:5},affiliationRules:[],competitiveProfile:null,frozenCompetitiveFacts:[]})}).returning();
      const [match]=await db.insert(schema.matches).values({seasonId,entryAId:entryIds[0]!,entryBId:entryIds[1]!,stage:"stage1",majorStageRunId:run!.id,ownership:"major_stage",managedKey:"1:0",round:1,format:"bo3",scheduledAt:new Date(Date.now()-600000)}).returning();
      await work({db,seasonId,userId,otherId,matchId:match!.id,entryIds});
    }finally{await pool.end();}
  });
}