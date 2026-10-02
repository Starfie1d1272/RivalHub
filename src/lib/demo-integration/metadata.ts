import "server-only";

import { matchDemoImports } from "@/db/schema";

/** Workflow/catalog reads must not download the immutable Evidence artifact. */
export const demoImportMetadataSelection = {
  id: matchDemoImports.id,
  seasonId: matchDemoImports.seasonId,
  matchId: matchDemoImports.matchId,
  matchMapId: matchDemoImports.matchMapId,
  stageKey: matchDemoImports.stageKey,
  stageRunId: matchDemoImports.stageRunId,
  demoSha256: matchDemoImports.demoSha256,
  payloadSha256: matchDemoImports.payloadSha256,
  contractVersion: matchDemoImports.contractVersion,
  semanticProfile: matchDemoImports.semanticProfile,
  analysisVersion: matchDemoImports.analysisVersion,
  evidenceRevision: matchDemoImports.evidenceRevision,
  status: matchDemoImports.status,
  submittedByPairingId: matchDemoImports.submittedByPairingId,
  idempotencyKey: matchDemoImports.idempotencyKey,
  supersedesImportId: matchDemoImports.supersedesImportId,
  issues: matchDemoImports.issues,
  submittedAt: matchDemoImports.submittedAt,
  confirmedAt: matchDemoImports.confirmedAt,
  createdAt: matchDemoImports.createdAt,
};

export type DemoImportMetadata = Pick<
  typeof matchDemoImports.$inferSelect,
  keyof typeof demoImportMetadataSelection
>;
