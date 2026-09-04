/**
 * Stable qualification output shared by live evaluation, Entry review and
 * frozen StageRun consumers.  A finding is a domain fact; its message is only
 * the human-readable projection of that fact.
 */
export interface QualificationFinding {
  code: string;
  message: string;
  waivable: boolean;
  metadata?: Record<string, unknown>;
}

export function uniqueQualificationFindings(
  findings: readonly QualificationFinding[],
): QualificationFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = JSON.stringify([finding.code, finding.message, finding.metadata ?? null]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function blockersFromQualificationFindings(
  findings: readonly QualificationFinding[],
): string[] {
  return [...new Set(findings.map((finding) => finding.message))];
}
