import { EDUCATION_EVIDENCE_RETENTION_MS } from "./retention-policy";

interface ExpiredManualEducationEvidence {
  id: string;
  evidenceObjectKey: string;
}

export interface EducationRetentionStore {
  findExpiredManualEvidence(reviewedBefore: Date): Promise<readonly ExpiredManualEducationEvidence[]>;
  removeEvidenceObject(objectKey: string): Promise<void>;
  clearManualEvidence(id: string, objectKey: string): Promise<number>;
  clearExpiredChsiCodes(reviewedBefore: Date): Promise<number>;
}

/**
 * Shared lifecycle algorithm used by the application scheduler and isolated
 * recovery. Persistence and Storage adapters stay at their respective edges;
 * this function remains the single owner of the seven-day semantics.
 */
export async function purgeExpiredEducationEvidence(
  store: EducationRetentionStore,
  now = new Date(),
): Promise<number> {
  const reviewedBefore = new Date(now.getTime() - EDUCATION_EVIDENCE_RETENTION_MS);
  const manualRows = await store.findExpiredManualEvidence(reviewedBefore);

  let manualCleared = 0;
  for (const row of manualRows) {
    await store.removeEvidenceObject(row.evidenceObjectKey);
    manualCleared += await store.clearManualEvidence(row.id, row.evidenceObjectKey);
  }

  return manualCleared + await store.clearExpiredChsiCodes(reviewedBefore);
}
