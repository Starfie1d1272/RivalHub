export type EducationVerificationStatus = "pending" | "approved" | "rejected";
export type AcademicStatus = "enrolled" | "graduated";

/**
 * Safe input for the public education projection. Keep this separate from
 * the persisted verification row so evidence and review fields cannot cross
 * the public presentation boundary by accident.
 */
export interface EducationVerificationForPublicPresentation {
  id: string;
  institutionId: string;
  institutionName: string;
  academicStatus: AcademicStatus;
  status: EducationVerificationStatus;
  submittedAt: Date;
}

export interface PublicEducationIdentity {
  institutionName: string;
  academicStatus: "在读" | "已毕业";
  verificationLabel: "已认证";
}

const ACADEMIC_STATUS_LABELS: Record<AcademicStatus, PublicEducationIdentity["academicStatus"]> = {
  enrolled: "在读",
  graduated: "已毕业",
};

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isLaterClaim(
  candidate: EducationVerificationForPublicPresentation,
  current: EducationVerificationForPublicPresentation,
): boolean {
  const candidateTime = candidate.submittedAt.getTime();
  const currentTime = current.submittedAt.getTime();
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  return compareText(candidate.id, current.id) > 0;
}

/**
 * Project immutable education history into the small public identity read
 * model. Pending and rejected claims never replace an approved claim because
 * only approved claims participate in the projection.
 */
export function presentPublicEducationIdentities(
  verifications: readonly EducationVerificationForPublicPresentation[],
): PublicEducationIdentity[] {
  const latestApprovedByInstitution = new Map<string, EducationVerificationForPublicPresentation>();

  for (const verification of verifications) {
    if (verification.status !== "approved") continue;
    const current = latestApprovedByInstitution.get(verification.institutionId);
    if (!current || isLaterClaim(verification, current)) {
      latestApprovedByInstitution.set(verification.institutionId, verification);
    }
  }

  return [...latestApprovedByInstitution.values()]
    .sort((left, right) => compareText(left.institutionName, right.institutionName) || compareText(left.institutionId, right.institutionId))
    .map((verification) => ({
      institutionName: verification.institutionName,
      academicStatus: ACADEMIC_STATUS_LABELS[verification.academicStatus],
      verificationLabel: "已认证" as const,
    }));
}
