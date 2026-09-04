import { and, eq, inArray, isNull } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  competitionEntryRestrictionOverrides,
  type CompetitionEntryRestrictionOverride,
} from "@/db/schema";
import type { QualificationFinding } from "@/lib/qualification/finding";

export type FindingSnapshot = QualificationFinding;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function snapshotQualificationFinding(finding: QualificationFinding): FindingSnapshot {
  return canonicalize({
    code: finding.code,
    message: finding.message,
    waivable: finding.waivable,
    ...(finding.metadata ? { metadata: finding.metadata } : {}),
  }) as FindingSnapshot;
}

export function sameQualificationFindingSnapshot(
  snapshot: unknown,
  finding: QualificationFinding,
): boolean {
  return JSON.stringify(canonicalize(snapshot)) === JSON.stringify(snapshotQualificationFinding(finding));
}

export async function loadActiveRestrictionOverridesInTx(
  tx: TxDb,
  input: { competitionId: string; entryIds: readonly string[]; rosterRevisionIds?: readonly string[] },
): Promise<CompetitionEntryRestrictionOverride[]> {
  if (input.entryIds.length === 0) return [];
  const conditions = [
    eq(competitionEntryRestrictionOverrides.competitionId, input.competitionId),
    inArray(competitionEntryRestrictionOverrides.entryId, [...new Set(input.entryIds)]),
    isNull(competitionEntryRestrictionOverrides.revokedAt),
  ];
  if (input.rosterRevisionIds && input.rosterRevisionIds.length === 0) return [];
  if (input.rosterRevisionIds) {
    conditions.push(inArray(competitionEntryRestrictionOverrides.rosterRevisionId, [...new Set(input.rosterRevisionIds)]));
  }
  return tx.select().from(competitionEntryRestrictionOverrides).where(and(...conditions));
}

export function unresolvedQualificationFindings(
  findings: readonly QualificationFinding[],
  overrides: readonly { restrictionCode: string; findingSnapshot: unknown }[],
): QualificationFinding[] {
  return findings.filter((finding) => {
    if (!finding.waivable) return true;
    const override = overrides.find((candidate) => candidate.restrictionCode === finding.code);
    return !override || !sameQualificationFindingSnapshot(override.findingSnapshot, finding);
  });
}
