/** Canonical retention duration for temporary education evidence. */
export const EDUCATION_EVIDENCE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function educationEvidenceReviewCutoff(now = new Date()): Date {
  return new Date(now.getTime() - EDUCATION_EVIDENCE_RETENTION_MS);
}

/** Pending reviews have no expiry; the completed review timestamp owns the boundary. */
export function isEducationEvidenceExpired(review: { status: string; reviewedAt: Date | null }, now = new Date()): boolean {
  return review.status !== "pending" && review.reviewedAt !== null && review.reviewedAt <= educationEvidenceReviewCutoff(now);
}
