import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { eq, inArray } from 'drizzle-orm';
import { assertLocalDatabaseUrl } from '../scripts/db/local-environment';
import { replayActiveMigrationChain } from '../scripts/db/migration-replay';
async function main() {
const manifestPath = '.agent-tmp/wp05-rich-manifest.json';
const configured = assertLocalDatabaseUrl(process.env.DATABASE_URL, 'DATABASE_URL');
const maintenance = new URL(configured); maintenance.pathname='/postgres';
const command = process.argv[2];
const admin = new Client({ connectionString: maintenance.href, ssl:false });
await admin.connect();
try {
 if(command==='drop') {
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  if(!/^rh_wp05_browser_[a-f0-9]{12}$/.test(manifest.database))throw new Error('Invalid owned database');
  await admin.query(`DROP DATABASE IF EXISTS "${manifest.database}" WITH (FORCE)`);
  console.log('WP05 isolated browser database dropped');
 } else if(command==='create') {
  const database='rh_wp05_browser_'+randomUUID().replaceAll('-','').slice(0,12);
  await admin.query(`CREATE DATABASE "${database}" TEMPLATE template1`);
  writeFileSync(manifestPath,JSON.stringify({database}));
  const target=new URL(configured);target.pathname='/'+database;
  process.env.DATABASE_URL=target.href;process.env.RIVALHUB_LOCAL_DATABASE_URL=target.href;
  replayActiveMigrationChain(target.href,process.env);
  const {db}=await import('../src/db/client'); const s=await import('../src/db/schema');
  const {seedFixture}=await import('../tests/integration/db/harness/mizar');
  const {loadCanonicalTarget,validateCanonicalTarget}=await import('../src/lib/demo-integration/validation');
  const {buildEvidenceRevisionForTarget}=await import('../src/lib/demo-integration/revision');
  const {parseRivalHubDemoEvidenceV1}=await import('../src/lib/demo-evidence/contract');
  const {materializeStatisticsProjectionInTx}=await import('../src/lib/stats/projection');
  const {CURRENT_DAK_SEMANTIC_PROFILE}=await import('../src/lib/demo-integration/semantic-profile');
  const {getPlayerCareerDetail}=await import('../src/lib/stats/tournament-query');
  const source=JSON.parse(readFileSync('tests/fixtures/demo-evidence/normal-map-v1.json','utf8'));
  const f=await seedFixture({unboundSource:true});
  const users=await db.select({id:s.users.id,steam64:s.users.steam64}).from(s.users).where(inArray(s.users.steam64,f.steam64));
  const userId=users.find(u=>u.steam64===f.steam64[0])!.id;
  await db.update(s.users).set({displayName:'WP05 Detailed Player'}).where(eq(s.users.id,userId));
  await db.update(s.seasons).set({name:'WP05 Detailed Event',slug:'wp05-detailed',status:'playing'}).where(eq(s.seasons.id,f.seasonId));
  const finish=new Date('2026-10-01T12:00:00Z');
  await db.update(s.matches).set({status:'finished',scoreA:2,scoreB:0,completedAt:finish}).where(eq(s.matches.id,f.matchId));
  const jobs=[{event:f,mapIds:[f.mapOneId,f.mapTwoId]}];
  let secondSlug: string | undefined;
  if(process.argv[3]==='multi') {
    secondSlug='wp05-detailed-second';
    const seasonId=randomUUID(),matchId=randomUUID(),mapOneId=randomUUID();
    const entryIds=[randomUUID(),randomUUID()],revisions=[randomUUID(),randomUUID()],rosters=[randomUUID(),randomUUID()],matchRosters=[randomUUID(),randomUUID()];
    const orderedUsers=f.steam64.map(steam=>users.find(u=>u.steam64===steam)!.id);
    const participants=orderedUsers.map(()=>randomUUID()),members=orderedUsers.map(()=>randomUUID());
    await db.transaction(async tx=>{
      await tx.insert(s.seasons).values({id:seasonId,name:'WP05 Historical Event',slug:secondSlug!,kind:'custom',status:'archived'});
      await tx.insert(s.competitionEntries).values(entryIds.map((id,i)=>({id,competitionId:seasonId,source:'event_native' as const,name:'Historical '+(i?'B':'A'),representativeUserId:orderedUsers[i*5]!,registrationStatus:'approved' as const,currentRosterRevisionId:revisions[i]!,approvedRosterRevisionId:revisions[i]!})));
      await tx.insert(s.competitionEntryRepresentativeChanges).values(entryIds.map((entryId,i)=>({entryId,toUserId:orderedUsers[i*5]!,changedByActorId:'local-fixture'})));
      await tx.insert(s.competitionEntryRosterRevisions).values(entryIds.map((entryId,i)=>({id:revisions[i]!,entryId,revisionNumber:1,status:'approved' as const,createdBy:'local-fixture'})));
      await tx.insert(s.competitionEntryParticipants).values(orderedUsers.map((userId,i)=>({id:participants[i]!,entryId:entryIds[i<5?0:1]!,userId,status:'confirmed' as const,invitedByUserId:orderedUsers[i<5?0:5]!,confirmedAt:finish})));
      await tx.insert(s.competitionEntryRosterMembers).values(orderedUsers.map((userId,i)=>({revisionId:revisions[i<5?0:1]!,participantId:participants[i]!,userId,isPrimaryStarter:true})));
      await tx.insert(s.eventRosters).values(entryIds.map((entryId,i)=>({id:rosters[i]!,entryId,sourceRosterRevisionId:revisions[i]!,status:'confirmed' as const,confirmedAt:finish,confirmedBy:'local-fixture'})));
      await tx.insert(s.eventRosterMembers).values(orderedUsers.map((userId,i)=>({id:members[i]!,eventRosterId:rosters[i<5?0:1]!,userId,participantId:participants[i]!,isPrimaryStarter:true})));
      await tx.insert(s.matches).values({id:matchId,seasonId,entryAId:entryIds[0]!,entryBId:entryIds[1]!,stage:'fixture-stage',format:'bo1',status:'finished',scoreA:1,scoreB:0,completedAt:finish});
      await tx.insert(s.matchMaps).values({id:mapOneId,matchId,mapOrder:1,mapName:'de_ancient',scoreA:13,scoreB:9,completedAt:finish});
      await tx.insert(s.matchRosters).values(entryIds.map((entryId,i)=>({id:matchRosters[i]!,matchId,entryId,source:'admin_select' as const,status:'submitted' as const})));
      await tx.insert(s.matchRosterPlayers).values(orderedUsers.map((_id,i)=>({rosterId:matchRosters[i<5?0:1]!,eventRosterMemberId:members[i]!,isStarter:true})));
    });
    jobs.push({event:{...f,seasonId,matchId,mapOneId,entryAId:entryIds[0]!,entryBId:entryIds[1]!},mapIds:[mapOneId]});
  }
  const pairingIntentId=randomUUID(),pairingId=randomUUID();
  await db.insert(s.dakPairingIntents).values({id:pairingIntentId,pollTokenHash:randomUUID(),expiresAt:new Date(Date.now()+600000)});
  await db.insert(s.dakPairings).values({id:pairingId,pairingIntentId,userId,tokenHash:randomUUID(),scopes:['events:read','evidence:write'],seasonIds:jobs.map(job=>job.event.seasonId)});
  for(const {event:f,mapIds} of jobs) {
  for(const [index,mapId] of mapIds.entries()) {
   await db.update(s.matchMaps).set({scoreA:13,scoreB:9,completedAt:finish}).where(eq(s.matchMaps.id,mapId));
   await db.transaction(async tx=>{
    const target=await loadCanonicalTarget(tx,{seasonId:f.seasonId,matchId:f.matchId,matchMapId:mapId});
    const revision=buildEvidenceRevisionForTarget(target);
    let text=JSON.stringify(source);const offsets={teamA:0,teamB:0};
    const members={teamA:target.roster.filter(m=>m.entryId===f.entryAId),teamB:target.roster.filter(m=>m.entryId===f.entryBId)};
    for(const p of source.participants){const member=members[p.observedTeamKey as 'teamA'|'teamB'][offsets[p.observedTeamKey as 'teamA'|'teamB']++]!;text=text.replaceAll(p.steamId64,member.steam64!);}
    const evidence=parseRivalHubDemoEvidenceV1(JSON.parse(text));
    evidence.contract.semanticProfile=CURRENT_DAK_SEMANTIC_PROFILE;
    Object.assign(evidence.target,{seasonId:f.seasonId,matchId:f.matchId,matchMapId:mapId,mapOrder:index+1,entryAId:f.entryAId,entryBId:f.entryBId,expectedMapName:target.map.mapName,evidenceRevision:revision});
    for(const participant of evidence.participants){
      const member=target.roster.find(m=>m.steam64===participant.steamId64)!;
      participant.resolution={status:'matched',userId:member.userId,eventRosterMemberId:member.eventRosterMemberId,entryId:member.entryId};
    }
    delete evidence.target.stageRunId;
    evidence.source.mapName=target.map.mapName;
    parseRivalHubDemoEvidenceV1(evidence);
    const validation=await validateCanonicalTarget(tx,evidence,target);
    if(validation.issues.length)throw new Error(JSON.stringify(validation.issues));
    const payloadSha256=createHash('sha256').update(JSON.stringify(evidence)).digest('hex');const importId=randomUUID();
    const [row]=await tx.insert(s.matchDemoImports).values({id:importId,seasonId:f.seasonId,matchId:f.matchId,matchMapId:mapId,stageKey:target.match.stage,demoSha256:evidence.source.demoSha256,payloadSha256,contractVersion:'rivalhub-demo-evidence/1',semanticProfile:CURRENT_DAK_SEMANTIC_PROFILE,analysisVersion:'wp05-local-fixture',evidenceRevision:revision,status:'confirmed',payload:evidence,submittedByPairingId:pairingId,confirmedAt:finish}).returning();
    await materializeStatisticsProjectionInTx({tx,row:row!,evidence,target,resolutions:validation.resolutions});
    await tx.insert(s.matchPlayerStats).values(target.roster.map(m=>({matchId:f.matchId,mapId,userId:m.userId,perfectName:'Local fixture '+m.userId,dakImportId:importId,verifiedByAdmin:'wp05-local-fixture',kills:20+index,deaths:10,assists:3,adr:85,ratingPro:1.25})));
   });
  }
  }
  const sanctionId=randomUUID();
  await db.insert(s.disciplinaryCases).values([
   {id:sanctionId,seasonId:f.seasonId,subjectUserId:userId,status:'active',effects:['match_participation_block'],publicExplanation:'WP05_PUBLIC_ACTIVE',internalEvidence:'WP05_PRIVATE_EVIDENCE_NEVER_PUBLIC',issuedBy:'local-fixture',effectiveFrom:new Date('2026-10-01')},
   {seasonId:f.seasonId,subjectUserId:userId,status:'draft',publicExplanation:'WP05_DRAFT_NEVER_PUBLIC',internalEvidence:'WP05_PRIVATE_DRAFT',issuedBy:'local-fixture'},
   {seasonId:f.seasonId,subjectUserId:userId,status:'active',publicExplanation:'WP05_FUTURE_NEVER_PUBLIC',issuedBy:'local-fixture',effectiveFrom:new Date('2099-01-01')},
  ]);
  const emptyId=randomUUID();await db.insert(s.users).values({id:emptyId,email:emptyId+'@local.test',displayName:'WP05 No History'});
  const all=await getPlayerCareerDetail({playerId:userId});const filtered=await getPlayerCareerDetail({playerId:userId,eventSlug:'wp05-detailed',mapFilter:'de_mirage'});
  if(!all.performance||!filtered.performance||all.coverage.detailedMaps!==jobs.reduce((total,job)=>total+job.mapIds.length,0)||filtered.coverage.detailedMaps!==1)throw new Error('Detailed fixture did not pass actual reader');
  const manifest={database,userId,emptyId,sanctionId,seasonId:f.seasonId,slug:'wp05-detailed',secondSlug,preflight:{all:{summary:all.summary,coverage:all.coverage,performance:!!all.performance},filtered:{summary:filtered.summary,coverage:filtered.coverage,performance:!!filtered.performance}}};
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2));console.log(JSON.stringify({database,preflight:manifest.preflight}));
 } else throw new Error('Expected create/drop');
} finally {await admin.end()}

}
void main().catch(error=>{console.error(error);process.exitCode=1});
