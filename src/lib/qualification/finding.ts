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

interface QualificationFindingIdentity {
  code: string;
  waivable: boolean;
  metadata?: Record<string, unknown>;
}

const EXTERNAL_STRENGTH_FACT_KEYS = [
  "strongestExternalStars",
  "strongestHomeStars",
  "externalStrengthMaxStarGap",
] as const;

/**
 * Stable semantic metadata for the finding identity.  The selected strongest
 * players are evidence for the policy fact, not part of its identity; their
 * IDs and labels must not revoke an existing policy decision.
 */
function semanticFindingMetadata(
  finding: Pick<QualificationFinding, "code" | "metadata">,
): Record<string, unknown> | undefined {
  if (!finding.metadata) return undefined;
  if (finding.code !== "external_strength_gap") return finding.metadata;
  const semantic = Object.fromEntries(
    EXTERNAL_STRENGTH_FACT_KEYS
      .filter((key) => key in finding.metadata!)
      .map((key) => [key, finding.metadata![key]]),
  );
  return Object.keys(semantic).length > 0 ? semantic : undefined;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

/** Returns the domain fact used by dedupe and restriction override matching. */
function qualificationFindingIdentity(
  finding: Pick<QualificationFinding, "code" | "waivable" | "metadata">,
): QualificationFindingIdentity {
  const metadata = semanticFindingMetadata(finding);
  return {
    code: finding.code,
    waivable: finding.waivable,
    ...(metadata ? { metadata: canonicalize(metadata) as Record<string, unknown> } : {}),
  };
}

function qualificationFindingFingerprint(
  finding: Pick<QualificationFinding, "code" | "waivable" | "metadata">,
): string {
  return JSON.stringify(qualificationFindingIdentity(finding));
}

/**
 * Compare a persisted snapshot with the current semantic fact.  Presentation
 * fields, including message, are intentionally ignored; malformed snapshots
 * fail closed instead of being treated as a matching override.
 */
export function sameQualificationFindingFact(
  snapshot: unknown,
  finding: Pick<QualificationFinding, "code" | "waivable" | "metadata">,
): boolean {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const candidate = snapshot as Record<string, unknown>;
  if (typeof candidate.code !== "string" || typeof candidate.waivable !== "boolean") return false;
  if ("metadata" in candidate && (!candidate.metadata || typeof candidate.metadata !== "object" || Array.isArray(candidate.metadata))) {
    return false;
  }
  return qualificationFindingFingerprint({
    code: candidate.code,
    waivable: candidate.waivable,
    ...(candidate.metadata ? { metadata: candidate.metadata as Record<string, unknown> } : {}),
  }) === qualificationFindingFingerprint(finding);
}

/** An existing approval covers an unchanged or reduced external strength gap. */
export function qualificationFindingCoveredByApproval(
  snapshot: unknown,
  finding: QualificationFinding,
): boolean {
  if (sameQualificationFindingFact(snapshot, finding)) return true;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const approved = snapshot as Partial<QualificationFinding>;
  if (approved.code !== "external_strength_gap" || finding.code !== approved.code ||
      approved.waivable !== true || finding.waivable !== true) return false;
  const previous = approved.metadata;
  const current = finding.metadata;
  if (!previous || !current) return false;
  const keys = EXTERNAL_STRENGTH_FACT_KEYS;
  if (keys.some((key) => typeof previous[key] !== "number" || !Number.isFinite(previous[key]) ||
      typeof current[key] !== "number" || !Number.isFinite(current[key]) ||
      (previous[key] as number) < 0 || (current[key] as number) < 0)) return false;
  if (previous.externalStrengthMaxStarGap !== current.externalStrengthMaxStarGap) return false;
  const previousGap = (previous.strongestExternalStars as number) - (previous.strongestHomeStars as number);
  const currentGap = (current.strongestExternalStars as number) - (current.strongestHomeStars as number);
  return previousGap > (previous.externalStrengthMaxStarGap as number) && currentGap <= previousGap;
}

export function uniqueQualificationFindings(
  findings: readonly QualificationFinding[],
): QualificationFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = qualificationFindingFingerprint(finding);
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
