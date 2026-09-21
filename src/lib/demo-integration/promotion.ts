import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { matchDemoImports, matchPlayerStats, matchRoundFacts } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import type { GameplayUserResolution } from "@/lib/identity/gameplay-steam";
import type { RivalHubEvidenceSubmission } from "./contracts";
import { dakStableScoreboardValues } from "./scoreboard";
import type { CanonicalTarget } from "./validation";

export interface PromoteDemoImportInput {
  tx: TxDb;
  row: typeof matchDemoImports.$inferSelect;
  evidence: RivalHubEvidenceSubmission;
  target: CanonicalTarget;
  resolutions: Map<string, GameplayUserResolution>;
  actorId: string;
  verifiedBy: string;
  auditAction: "match.demo.auto_confirm" | "match.demo.recheck";
  retryPromotion: boolean;
}

export const DEMO_CONTENT_CONFLICT_MESSAGE = "该地图已有另一份已确认 Demo；不同内容必须显式进入冲突处理，不能静默覆盖。";

const LINEAGE_ACTIVE_STATUSES = ["confirmed", "needs_attention", "stale"] as const;

type LineageActiveStatus = typeof LINEAGE_ACTIVE_STATUSES[number];

export interface DemoImportLineage {
  sameContent?: typeof matchDemoImports.$inferSelect;
  sameDemoPriors: Array<typeof matchDemoImports.$inferSelect & { status: LineageActiveStatus }>;
  sameDemoPredecessor?: typeof matchDemoImports.$inferSelect & { status: LineageActiveStatus };
  differentDemoConfirmed?: typeof matchDemoImports.$inferSelect;
}

export function isSameDemoImportContent(
  row: typeof matchDemoImports.$inferSelect,
  content: Pick<DemoImportLineageInput, "demoSha256" | "payloadSha256">,
): boolean {
  return row.demoSha256 === content.demoSha256 && row.payloadSha256 === content.payloadSha256;
}

interface DemoImportLineageInput {
  matchMapId: string;
  demoSha256: string;
  payloadSha256: string;
  currentImportId?: string;
}

export async function resolveDemoImportLineageInTx(
  tx: TxDb,
  input: DemoImportLineageInput,
): Promise<DemoImportLineage> {
  const rows = await tx.select().from(matchDemoImports)
    .where(eq(matchDemoImports.matchMapId, input.matchMapId))
    .orderBy(desc(matchDemoImports.createdAt), desc(matchDemoImports.id))
    .for("update");
  const priorRows = rows.filter((row) => row.id !== input.currentImportId);
  const sameDemoPriors = priorRows.filter((row): row is typeof row & { status: LineageActiveStatus } =>
    row.demoSha256 === input.demoSha256 && LINEAGE_ACTIVE_STATUSES.includes(row.status as LineageActiveStatus),
  );
  return {
    sameContent: priorRows.find((row) => isSameDemoImportContent(row, input)),
    sameDemoPriors,
    sameDemoPredecessor: sameDemoPriors.find((row) => row.status === "confirmed") ?? sameDemoPriors[0],
    differentDemoConfirmed: priorRows.find((row) => row.status === "confirmed" && row.demoSha256 !== input.demoSha256),
  };
}

function roundFactValues(
  importId: string,
  evidence: RivalHubEvidenceSubmission,
) {
  return evidence.sourceFacts.rounds.map((row) => ({
    importId,
    roundSeq: row.roundSeq,
    sourceRoundNumber: row.sourceRoundNumber,
    phase: row.phase,
    startTick: row.startTick,
    freezeEndTick: row.freezeEndTick,
    endTick: row.endTick,
    teamASide: row.teamASide,
    teamBSide: row.teamBSide,
    teamAScoreBefore: row.teamAScoreBefore,
    teamBScoreBefore: row.teamBScoreBefore,
    teamAEconomy: row.teamAEconomy,
    teamBEconomy: row.teamBEconomy,
    winnerTeamKey: row.winnerTeamKey,
    winnerSide: row.winnerSide,
    endReason: row.endReason,
  }));
}

async function materializeRoundFacts(
  tx: TxDb,
  importId: string,
  evidence: RivalHubEvidenceSubmission,
): Promise<void> {
  const expected = roundFactValues(importId, evidence);
  const existing = await tx.select().from(matchRoundFacts)
    .where(eq(matchRoundFacts.importId, importId))
    .for("update");
  const comparable = (row: typeof matchRoundFacts.$inferSelect) => ({
    importId: row.importId,
    roundSeq: row.roundSeq,
    sourceRoundNumber: row.sourceRoundNumber,
    phase: row.phase,
    startTick: row.startTick,
    freezeEndTick: row.freezeEndTick,
    endTick: row.endTick,
    teamASide: row.teamASide,
    teamBSide: row.teamBSide,
    teamAScoreBefore: row.teamAScoreBefore,
    teamBScoreBefore: row.teamBScoreBefore,
    teamAEconomy: row.teamAEconomy,
    teamBEconomy: row.teamBEconomy,
    winnerTeamKey: row.winnerTeamKey,
    winnerSide: row.winnerSide,
    endReason: row.endReason,
  });
  if (existing.length > 0) {
    const actualBySeq = new Map(existing.map((row) => [row.roundSeq, comparable(row)]));
    const expectedBySeq = new Map(expected.map((row) => [row.roundSeq, row]));
    if (actualBySeq.size !== expectedBySeq.size || [...expectedBySeq].some(([seq, row]) => JSON.stringify(actualBySeq.get(seq)) !== JSON.stringify(row))) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "已保存的 Demo 回合事实与当前 payload 不一致。");
    }
    return;
  }
  await tx.insert(matchRoundFacts).values(expected);
}

async function materializePlayerStats(
  tx: TxDb,
  input: PromoteDemoImportInput,
): Promise<number> {
  const { evidence, target, resolutions } = input;
  const existing = await tx.select().from(matchPlayerStats)
    .where(eq(matchPlayerStats.mapId, target.map.id))
    .for("update");
  const byUser = new Map<string, typeof existing[number]>();
  const byName = new Map<string, typeof existing[number]>();
  for (const row of existing) {
    if (row.userId) {
      if (byUser.has(row.userId)) throw new AppError(ErrorCode.INTERNAL_ERROR, "同一地图存在重复的选手统计记录。");
      byUser.set(row.userId, row);
    } else if (!byName.has(row.perfectName)) {
      byName.set(row.perfectName, row);
    }
  }

  const participantBySteam = new Map(evidence.participants.map((participant) => [participant.steamId64, participant]));
  let count = 0;
  for (const summary of evidence.summaries.playerMaps) {
    const participant = participantBySteam.get(summary.steamId64);
    const resolution = resolutions.get(summary.steamId64);
    if (!participant || !resolution) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "Demo 统计缺少经过服务端确认的选手身份。");
    }
    const scoreboardValues = dakStableScoreboardValues(summary);
    const values = {
      matchId: target.match.id,
      mapId: target.map.id,
      perfectName: participant.nameSnapshot,
      userId: resolution.userId,
      kills: summary.kills,
      deaths: summary.deaths,
      assists: summary.assists,
      hsPercent: scoreboardValues.hsPercent,
      firstKills: scoreboardValues.firstKills,
      firstDeaths: summary.firstDeaths,
      multiKills: scoreboardValues.multiKills,
      tradeKills: summary.tradeKills,
      kastRounds: summary.kastRounds,
      clutches: scoreboardValues.clutches,
      adr: scoreboardValues.adr,
      dakImportId: input.row.id,
      verifiedByAdmin: input.verifiedBy,
      verifiedAt: new Date(),
    };
    const existingRow = byUser.get(resolution.userId)
      ?? (byName.get(participant.nameSnapshot)?.userId == null ? byName.get(participant.nameSnapshot) : undefined);
    if (existingRow) {
      await tx.update(matchPlayerStats).set(values).where(eq(matchPlayerStats.id, existingRow.id));
    } else {
      await tx.insert(matchPlayerStats).values(values);
    }
    count += 1;
  }
  return count;
}

export async function promoteDemoImportInTx(input: PromoteDemoImportInput): Promise<{ playerCount: number; roundCount: number }> {
  const lineage = await resolveDemoImportLineageInTx(input.tx, {
    matchMapId: input.row.matchMapId,
    demoSha256: input.row.demoSha256,
    payloadSha256: input.row.payloadSha256,
    currentImportId: input.row.id,
  });
  if (lineage.differentDemoConfirmed) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, DEMO_CONTENT_CONFLICT_MESSAGE);
  }

  const supersededImportIds = lineage.sameDemoPriors.map((row) => row.id);
  if (supersededImportIds.length > 0) {
    await input.tx.update(matchDemoImports).set({ status: "superseded" }).where(and(
      eq(matchDemoImports.matchMapId, input.row.matchMapId),
      inArray(matchDemoImports.id, supersededImportIds),
    ));
  }

  const supersedesImportId = lineage.sameDemoPredecessor?.id ?? input.row.supersedesImportId ?? null;

  await input.tx.update(matchDemoImports).set({
    status: "confirmed",
    issues: [],
    confirmedAt: input.row.confirmedAt ?? new Date(),
    supersedesImportId,
  }).where(eq(matchDemoImports.id, input.row.id));
  await materializeRoundFacts(input.tx, input.row.id, input.evidence);
  const playerCount = await materializePlayerStats(input.tx, input);
  await writeAuditInTx(input.tx, {
    seasonId: input.target.match.seasonId,
    action: input.auditAction,
    actorId: input.actorId,
    targetId: input.row.id,
    meta: {
      mapOrder: input.target.map.mapOrder,
      playerCount,
      rounds: input.evidence.sourceFacts.rounds.length,
      ...(input.retryPromotion ? { retryPromotion: true } : {}),
      ...(supersedesImportId ? { supersedesImportId } : {}),
      ...(supersededImportIds.length > 0 ? { supersededImportIds } : {}),
    },
  });
  return { playerCount, roundCount: input.evidence.sourceFacts.rounds.length };
}
