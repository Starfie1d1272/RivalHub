import { z } from "zod";
import { rivalHubDemoEvidenceV1Schema } from "@/lib/demo-evidence/contract";

export const DAK_INTEGRATION_VERSION = "rivalhub-dak-events/1" as const;
export const DAK_SCOPES = ["event:read", "demo:submit", "demo:status"] as const;
export type DakScope = (typeof DAK_SCOPES)[number];

export const rivalHubDemoSyncStatusSchema = z.enum([
  "not_started",
  "live",
  "finished_pending_demo",
  "demo_processing",
  "synced",
  "needs_attention",
]);
export type RivalHubDemoSyncStatus = z.infer<typeof rivalHubDemoSyncStatusSchema>;

const integrationIssueSchema = z.object({
  code: z.string().min(1),
  path: z.string().min(1).optional(),
  message: z.string().min(1),
}).strict();

const remotePlayerSchema = z.object({
  entryId: z.guid(),
  userId: z.guid(),
  eventRosterMemberId: z.guid(),
  steamId64: z.string().regex(/^\d{17}$/),
  name: z.string().min(1),
  isStarter: z.boolean(),
}).strict();

const remoteTeamSchema = z.object({
  key: z.guid(),
  name: z.string().min(1),
  players: z.array(remotePlayerSchema),
}).strict();

const remoteStageSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["round_robin", "swiss", "single_elim", "double_elim", "gsl_group"]),
  teamCount: z.number().int().positive(),
  advanceCount: z.number().int().nonnegative(),
  matchFormat: z.enum(["bo1", "bo3", "bo5"]).nullable(),
  finalFormat: z.enum(["bo3", "bo5"]).nullable(),
  bracketNodes: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    round: z.number().int().positive(),
    lane: z.enum(["single", "winner", "loser", "grand"]),
    nextWinNodeId: z.string().nullable(),
    nextLossNodeId: z.string().nullable(),
  }).strict()).optional(),
}).strict();

const remoteMapSchema = z.object({
  id: z.guid(),
  order: z.number().int().positive().max(5),
  mapName: z.string().min(1),
  scoreA: z.number().int().nonnegative().nullable(),
  scoreB: z.number().int().nonnegative().nullable(),
  completedAt: z.string().datetime().nullable(),
  evidenceRevision: z.string().min(1),
  target: z.object({
    seasonId: z.guid(),
    stageKey: z.string().min(1),
    stageRunId: z.guid().nullable(),
    matchId: z.guid(),
    matchMapId: z.guid(),
    mapOrder: z.number().int().positive().max(5),
    entryAId: z.guid(),
    entryBId: z.guid(),
    expectedMapName: z.string().min(1),
    evidenceRevision: z.string().min(1),
  }).strict(),
  lineup: z.array(remotePlayerSchema),
  demoStatus: rivalHubDemoSyncStatusSchema,
  demoIssues: z.array(integrationIssueSchema),
  importId: z.guid().nullable(),
  demoSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict();

const remoteVetoStepSchema = z.object({
  stepOrder: z.number().int().positive(),
  actionType: z.string().min(1),
  mapName: z.string().min(1),
  teamKey: z.enum(["teamA", "teamB"]).nullable(),
  side: z.enum(["t", "ct"]).nullable(),
}).strict();

const remoteVetoSchema = z.object({
  version: z.literal("cs2-demo-analysis-kit/series-veto-0.1"),
  seriesId: z.string().min(1),
  format: z.enum(["bo1", "bo3", "bo5"]),
  teamAName: z.string().min(1),
  teamBName: z.string().min(1),
  mapPool: z.array(z.string().min(1)),
  steps: z.array(remoteVetoStepSchema),
  maps: z.object({
    picked: z.array(z.object({ mapName: z.string().min(1), teamKey: z.enum(["teamA", "teamB"]) }).strict()),
    banned: z.array(z.object({ mapName: z.string().min(1), teamKey: z.enum(["teamA", "teamB"]) }).strict()),
    decider: z.string().nullable(),
  }).strict(),
  sideChoices: z.array(z.object({ mapName: z.string().min(1), teamKey: z.enum(["teamA", "teamB"]).nullable(), side: z.enum(["t", "ct"]) }).strict()),
}).strict();

const remoteSeriesSchema = z.object({
  id: z.guid(),
  key: z.string().min(1),
  stageKey: z.string().min(1),
  round: z.number().int().nonnegative().nullable(),
  entryRound: z.string().nullable(),
  bracketNodeId: z.string().nullable(),
  status: z.enum(["scheduled", "in_progress", "finished", "cancelled"]),
  format: z.enum(["bo1", "bo3", "bo5"]),
  entryAId: z.guid(),
  entryBId: z.guid(),
  teamAKey: z.guid(),
  teamBKey: z.guid(),
  teamAName: z.string().min(1),
  teamBName: z.string().min(1),
  scoreA: z.number().int().nonnegative().nullable(),
  scoreB: z.number().int().nonnegative().nullable(),
  scheduledAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  teamARecordBefore: z.string().nullable(),
  teamBRecordBefore: z.string().nullable(),
  maps: z.array(remoteMapSchema),
  veto: remoteVetoSchema.nullable(),
}).strict();

const remoteEventSchema = z.object({
  id: z.guid(),
  seasonId: z.guid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  revision: z.string().min(1),
  stages: z.array(remoteStageSchema),
  teams: z.array(remoteTeamSchema),
  series: z.array(remoteSeriesSchema),
}).strict();

export const rivalHubEventsResponseSchema = z.object({
  contractVersion: z.literal(DAK_INTEGRATION_VERSION),
  generatedAt: z.string().datetime(),
  events: z.array(remoteEventSchema),
}).strict();

export type RivalHubRemotePlayer = z.infer<typeof remotePlayerSchema>;
export type RivalHubRemoteTeam = z.infer<typeof remoteTeamSchema>;
export type RivalHubRemoteStage = z.infer<typeof remoteStageSchema>;
export type RivalHubRemoteMap = z.infer<typeof remoteMapSchema>;
export type RivalHubRemoteSeries = z.infer<typeof remoteSeriesSchema>;
export type RivalHubRemoteEvent = z.infer<typeof remoteEventSchema>;
export type RivalHubEventsResponse = z.infer<typeof rivalHubEventsResponseSchema>;

export const rivalHubEvidenceSubmissionSchema = rivalHubDemoEvidenceV1Schema;
export type RivalHubEvidenceSubmission = z.infer<typeof rivalHubEvidenceSubmissionSchema>;

export interface IntegrationIssue {
  code: string;
  path?: string;
  message: string;
}

export interface EvidenceSubmissionResponse {
  status: "synced" | "needs_attention";
  importId: string | null;
  matchMapId: string;
  demoSha256: string;
  issues: IntegrationIssue[];
}
