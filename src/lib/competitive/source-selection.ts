import type { CompetitiveProfileConfig, CompetitiveSourceSelection } from "@/types/season";

/** New v2 snapshots own the top-level choice; older snapshots keep their original nested value. */
export function resolveCompetitiveSourceSelection(profile: CompetitiveProfileConfig | null | undefined): CompetitiveSourceSelection {
  return profile?.sourceSelection ?? profile?.evidencePolicy?.sourceSelection ?? "primary_then_fallback";
}

/** Project new v2 writes to one canonical field without mutating historical inputs. */
export function canonicalizeV2CompetitiveProfile(profile: CompetitiveProfileConfig | null): CompetitiveProfileConfig | null {
  if (!profile) return null;
  const evidencePolicy = profile.evidencePolicy ? { ...profile.evidencePolicy } : undefined;
  if (evidencePolicy) delete evidencePolicy.sourceSelection;
  return { ...profile, sourceSelection: resolveCompetitiveSourceSelection(profile), ...(evidencePolicy ? { evidencePolicy } : {}) };
}
