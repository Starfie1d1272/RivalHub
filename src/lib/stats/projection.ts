import "server-only";

import { collectTournamentPerformanceMapProjection } from "@cs2dak/tournament";
import type { TxDb } from "@/db/client";
import { matchDemoStatProjections, type StatisticsProjectionBinding } from "@/db/schema";
import type { DemoImportMetadata } from "@/lib/demo-integration/metadata";
import type { RivalHubEvidenceSubmission } from "@/lib/demo-integration/contracts";
import type { CanonicalTarget } from "@/lib/demo-integration/validation";
import type { GameplayUserResolution } from "@/lib/identity/gameplay-steam";
import { adaptStatsEvidence } from "./evidence-adapter";
import { STATISTICS_PROJECTION_VERSION } from "./projection-version";

export { STATISTICS_PROJECTION_VERSION } from "./projection-version";

export interface MaterializeStatisticsProjectionInput {
  tx: TxDb;
  row: DemoImportMetadata;
  evidence: RivalHubEvidenceSubmission;
  target: CanonicalTarget;
  resolutions: ReadonlyMap<string, GameplayUserResolution>;
}

/** Run in the confirmation transaction: there is no confirmed-without-projection window. */
export async function materializeStatisticsProjectionInTx(input: MaterializeStatisticsProjectionInput): Promise<void> {
  const rosterByUser = new Map(input.target.roster.map((member) => [member.userId, member]));
  const identityBindings: StatisticsProjectionBinding[] = input.evidence.participants.map((participant) => {
    const resolution = input.resolutions.get(participant.steamId64);
    const member = resolution ? rosterByUser.get(resolution.userId) : undefined;
    if (!resolution || !member) throw new Error("Statistics projection identity unavailable");
    return { steam64: participant.steamId64, userId: resolution.userId, entryId: member.entryId };
  }).sort((a, b) => a.steam64.localeCompare(b.steam64));
  const adapted = adaptStatsEvidence(input.evidence, new Map(identityBindings.map((binding) => [binding.steam64, binding])));
  const values = {
    importId: input.row.id,
    projectionVersion: STATISTICS_PROJECTION_VERSION,
    payloadSha256: input.row.payloadSha256,
    demoSha256: input.row.demoSha256,
    semanticProfile: input.row.semanticProfile,
    analysisVersion: input.row.analysisVersion,
    evidenceRevision: input.row.evidenceRevision,
    identityBindings,
    facts: {
      tournament: adapted.tournament,
      performance: collectTournamentPerformanceMapProjection(adapted.performance),
    },
  };
  // Rechecking an identity is allowed to rebuild the derived projection; the
  // source artifact/hash is never updated. Retries converge on the same key.
  await input.tx.insert(matchDemoStatProjections).values(values).onConflictDoUpdate({
    target: [matchDemoStatProjections.importId, matchDemoStatProjections.projectionVersion],
    set: { ...values, createdAt: new Date() },
  });
}
