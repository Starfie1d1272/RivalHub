import { z } from "zod";
import { qualificationPolicySchema, qualificationPolicyV2Schema } from "@/lib/competition/qualification-policy";
import { normalizeAffiliationRules, normalizeRegistrationConfig, normalizeTeamRegistrationConfig, resolveQualificationPolicy } from "@/lib/seasons/compatibility";
import type { Season, StoredTeamRegistrationConfigV2, QualificationPolicyV2 } from "@/types/season";
import type { QualificationFinding } from "@/lib/qualification/finding";
import type { ParticipantQualificationFacts } from "@/lib/qualification/facts";
import type { LineupMemberFact } from "@/lib/match-rosters/lineup";
import type { competitionEntries, competitionEntryRosterRevisions, competitionEntryParticipants, seasonRegistrations } from "@/db/schema";

export type SeasonRuleColumns = Omit<Pick<Season, "registrationMode" | "hasCaptainVoting" | "hasDraft" | "registrationConfig" | "teamRegistrationConfig" | "affiliationRules" | "minTeamSize" | "maxTeamSize" | "starterCount" | "positions" | "stagePlan" | "registrationOpensAt" | "registrationOpenedAt" | "registrationClosesAt" | "rosterChangeClosesAt">, "teamRegistrationConfig"> & { teamRegistrationConfig: Season["teamRegistrationConfig"] | StoredTeamRegistrationConfigV2 };

export const seasonRuleExtensionsSchema = z.object({
  formation: z.object({ draftTimeoutSeconds: z.number().int().min(1), votesPerPerson: z.number().int().min(1), minimumVotesToConfirm: z.number().int().min(0) }).strict(),
  seeding: z.object({ mode: z.enum(["manual", "strength_recommendation"]) }).strict(),
  lineup: z.object({ maxSubstitutes: z.number().int().min(0) }).strict(),
  rosterChanges: z.object({ representativeCanRemove: z.boolean(), representativeCanTransfer: z.boolean(), selfServiceAfterApproval: z.boolean() }).strict(),
});

type V2Extensions = z.infer<typeof seasonRuleExtensionsSchema>;
export type ParticipantRules = Pick<QualificationPolicyV2, "educationRequired" | "contacts" | "competitiveProfileRequired"> & {
  allowedPlayerTypes: Season["registrationConfig"]["allowedPlayerTypes"] | null;
  rankThreshold: Season["registrationConfig"]["rankThreshold"] | null;
  legacySolo: { emailRequired: true; studentIdRequired: true; qqRequired: true; steam64Required: true; perfectNameRequired: true } | null;
};
export type DecodedSeasonRules = {
  source: "legacy_solo" | "legacy_team" | "policy_v1" | "policy_v2";
  registration: Pick<SeasonRuleColumns, "registrationMode" | "registrationConfig" | "registrationOpensAt" | "registrationOpenedAt" | "registrationClosesAt">;
  formation: Pick<SeasonRuleColumns, "hasCaptainVoting" | "hasDraft"> & { captainSelection: "vote" | "admin"; settings: V2Extensions["formation"] | null };
  participant: ParticipantRules;
  roster: Pick<SeasonRuleColumns, "minTeamSize" | "maxTeamSize" | "affiliationRules"> & Pick<Season["teamRegistrationConfig"], "requirePositions" | "maxPerPositionPerTeam" | "requireUniqueTeamName" | "requireTeamLogo"> & Pick<SeasonRuleColumns, "positions"> & { legacyParticipant: ParticipantRules | null; changes: V2Extensions["rosterChanges"] | null; rosterChangeClosesAt: SeasonRuleColumns["rosterChangeClosesAt"] };
  lineup: Pick<SeasonRuleColumns, "starterCount"> & { settings: V2Extensions["lineup"] | null };
  competitive: Pick<QualificationPolicyV2, "competitiveProfile" | "externalStrengthGap">;
  competition: Pick<SeasonRuleColumns, "stagePlan"> & { seeding: V2Extensions["seeding"] | null };
};
/** Context is needed for any configured competitive purpose, independently. */
export function seasonRulesNeedCompetitiveContext(rules: Pick<DecodedSeasonRules, "participant" | "competitive">): boolean {
  return rules.participant.competitiveProfileRequired || rules.competitive.externalStrengthGap.enabled ||
    Boolean(rules.participant.rankThreshold?.currentMin || rules.participant.rankThreshold?.peakMin);
}

export type SeasonRuleColumnPatch = Partial<SeasonRuleColumns>;
export type QualificationDecision = { state: "ready"; findings: readonly [] } | { state: "blocked"; findings: readonly [QualificationFinding, ...QualificationFinding[]] };
/** Incomplete facts remain representable for readiness and remediation. */
export type ProfileReadinessFact = { status: "ranked" | "unranked"; rank: string | null; rating: number | null; stars: number | null; sourcePlatform: string; sourceSeasonKey: string | null };
export type ExternalStrengthFact = { label: string; rank: string | null; stars: number | null; sourcePlatform: string; sourceSeasonKey: string | null; sourceRank: string | null };
export type QualificationEvidence = { kind: "none" } | {
  kind: "competitive";
  context: { profile: import("@/types/season").CompetitiveProfileConfig | null; platform: string; rankOrder: readonly string[]; fallback: import("@/types/season").CompetitiveFallbackConversion | null; sourceSelection: "primary_then_fallback" | "strongest_equivalent"; evidencePolicy: import("@/types/season").CompetitiveEvidencePolicy | null };
  requirements: { historicalPeak: boolean; seasonKeys: readonly string[]; ratingRequired: boolean; exactStarsRequired: boolean };
  byPurpose: {
    profileReadiness: ReadonlyMap<string, { historicalPeak: ProfileReadinessFact | null; seasons: ReadonlyMap<string, ProfileReadinessFact | null> }>;
    rankThreshold: ReadonlyMap<string, { currentRank: string | null; peakRank: string | null }>;
    externalStrength: ReadonlyMap<string, ExternalStrengthFact>;
  };
};
export type ParticipantCandidate = { userId: string; facts: ParticipantQualificationFacts; playerType: import("@/types/season").PlayerType | null };
/** Complete candidate facts are assembled server-side under the Entry transaction. */
export type RosterCandidate = {
  season: Pick<Season, "id" | "registrationMode" | "status">;
  entry: Pick<typeof competitionEntries.$inferSelect, "id" | "competitionId" | "source" | "registrationStatus" | "currentRosterRevisionId" | "approvedRosterRevisionId"> & { name: string; logoPresent: boolean; nameConflicts: boolean };
  revision: Pick<typeof competitionEntryRosterRevisions.$inferSelect, "id" | "entryId" | "revisionNumber" | "status" | "origin">;
  members: readonly { userId: string; participantId: string; status: typeof competitionEntryParticipants.$inferSelect.status; isPrimaryStarter: boolean; primaryPosition: string | null; playerType: import("@/types/season").PlayerType | null }[];
  factsByUser: ReadonlyMap<string, ParticipantQualificationFacts>;
  currentTeamMemberUserIds: ReadonlySet<string> | null;
  nativeRegistrationsByUser: ReadonlyMap<string, Pick<typeof seasonRegistrations.$inferSelect, "id" | "status">>;
  activeClaimEntryByUser: ReadonlyMap<string, string>;
  registrationBlockedUserIds: ReadonlySet<string>;
  rosterBlockedUserIds: ReadonlySet<string>;
};
export type ProposedLineup = { entryId: string; starterMemberIds: readonly string[]; substituteMemberIds: readonly string[] };
export type FrozenLineupEligibility = {
  entryId: string; rosterRevisionId: string; starterCount: number; maxSubstitutes: number;
  affiliationRules: readonly import("@/types/season").InstitutionAffiliationRule[];
  educationRequired: boolean; competitiveProfileRequired: boolean;
  externalStrengthGap: QualificationPolicyV2["externalStrengthGap"];
  membersById: ReadonlyMap<string, LineupMemberFact>;
  evidence: QualificationEvidence;
  overrides: readonly { restrictionCode: string; findingSnapshot: QualificationFinding }[];
};
export type EvaluateParticipant = (candidate: ParticipantCandidate, participantRules: ParticipantRules, evidence: QualificationEvidence) => QualificationDecision;
export type EvaluateRoster = (candidate: RosterCandidate, rules: Pick<DecodedSeasonRules, "participant" | "roster" | "lineup" | "competitive">, evidence: QualificationEvidence) => QualificationDecision;
export type EvaluateLineup = (proposed: ProposedLineup, frozen: FrozenLineupEligibility, participationBlockedUserIds: ReadonlySet<string>) => QualificationDecision;
export type SoloAssessment = { participant: QualificationDecision; roster: { state: "pending_stage"; requiredAt: "roster_approval" } };


/** Decode stored rows; v1 and historical checks remain distinguishable. */
export function decodeSeasonRules(columns: SeasonRuleColumns): DecodedSeasonRules {
  const raw = columns.teamRegistrationConfig;
  const stored = raw.qualificationPolicy;
  let policy: ReturnType<typeof qualificationPolicyV2Schema.parse>;
  let rosterPolicy: ReturnType<typeof qualificationPolicyV2Schema.parse>;
  let source: DecodedSeasonRules["source"];
  let affiliationRules = normalizeAffiliationRules(columns.affiliationRules);
  let extensions: V2Extensions | null = null;
  const registrationConfig = normalizeRegistrationConfig(columns.registrationConfig);
  const legacyConfig = { ...raw, qualificationPolicy: stored?.version === 1 ? stored : undefined };
  const teamConfig = normalizeTeamRegistrationConfig(legacyConfig);
  if (stored?.version === 2) {
    const participantConfig = z.object({ allowedPlayerTypes: z.array(z.enum(["enrolled", "graduated", "external"])).min(1), rankThreshold: z.object({ currentMin: z.string().nullable(), peakMin: z.string().nullable() }) }).parse(columns.registrationConfig);
    registrationConfig.allowedPlayerTypes = participantConfig.allowedPlayerTypes;
    registrationConfig.rankThreshold = participantConfig.rankThreshold;
    affiliationRules = qualificationPolicySchema.shape.affiliationRules.parse(columns.affiliationRules);
    policy = qualificationPolicyV2Schema.parse(stored);
    rosterPolicy = policy;
    extensions = seasonRuleExtensionsSchema.parse(raw);
    source = "policy_v2";
  } else {
    if (stored && stored.version !== 1) throw new Error("Unsupported qualification policy version");
    const previous = stored ? qualificationPolicySchema.parse(stored) : resolveQualificationPolicy(legacyConfig, affiliationRules, "participant");
    const rosterPrevious = stored ? previous : resolveQualificationPolicy(legacyConfig, affiliationRules, "roster");
    if (stored) affiliationRules = normalizeAffiliationRules(previous.affiliationRules);
    policy = { version: 2, educationRequired: previous.educationRequired, contacts: previous.contacts, competitiveProfileRequired: previous.competitiveProfileRequired, competitiveProfile: previous.competitiveProfile, externalStrengthGap: previous.externalStrengthGap };
    rosterPolicy = { version: 2, educationRequired: rosterPrevious.educationRequired, contacts: rosterPrevious.contacts, competitiveProfileRequired: rosterPrevious.competitiveProfileRequired, competitiveProfile: rosterPrevious.competitiveProfile, externalStrengthGap: rosterPrevious.externalStrengthGap };
    source = stored ? "policy_v1" : columns.registrationMode === "solo" ? "legacy_solo" : "legacy_team";
  }
  return {
    source,
    registration: { registrationMode: columns.registrationMode, registrationConfig, registrationOpensAt: columns.registrationOpensAt, registrationOpenedAt: columns.registrationOpenedAt, registrationClosesAt: columns.registrationClosesAt },
    formation: { hasCaptainVoting: columns.hasCaptainVoting, hasDraft: columns.hasDraft, captainSelection: columns.hasCaptainVoting ? "vote" : "admin", settings: extensions?.formation ?? null },
    participant: { educationRequired: policy.educationRequired, contacts: source === "legacy_solo" ? { qqRequired: true, emailVerifiedRequired: false } : policy.contacts, competitiveProfileRequired: policy.competitiveProfileRequired, allowedPlayerTypes: source === "legacy_team" || source === "policy_v1" ? null : registrationConfig.allowedPlayerTypes, rankThreshold: source === "legacy_team" || source === "policy_v1" ? null : registrationConfig.rankThreshold, legacySolo: source === "legacy_solo" ? { emailRequired: true, studentIdRequired: true, qqRequired: true, steam64Required: true, perfectNameRequired: true } : null },
    roster: { minTeamSize: columns.minTeamSize, maxTeamSize: columns.maxTeamSize, affiliationRules, positions: columns.positions, requireUniqueTeamName: teamConfig.requireUniqueTeamName, requireTeamLogo: teamConfig.requireTeamLogo, requirePositions: teamConfig.requirePositions, maxPerPositionPerTeam: teamConfig.maxPerPositionPerTeam, legacyParticipant: source === "legacy_team" || source === "legacy_solo" ? { educationRequired: rosterPolicy.educationRequired, contacts: rosterPolicy.contacts, competitiveProfileRequired: rosterPolicy.competitiveProfileRequired, allowedPlayerTypes: source === "legacy_solo" ? registrationConfig.allowedPlayerTypes : null, rankThreshold: source === "legacy_solo" ? registrationConfig.rankThreshold : null, legacySolo: source === "legacy_solo" ? { emailRequired: true, studentIdRequired: true, qqRequired: true, steam64Required: true, perfectNameRequired: true } : null } : null, changes: extensions?.rosterChanges ?? null, rosterChangeClosesAt: columns.rosterChangeClosesAt },
    lineup: { starterCount: columns.starterCount, settings: extensions?.lineup ?? null },
    competitive: { competitiveProfile: policy.competitiveProfile, externalStrengthGap: policy.externalStrengthGap },
    competition: { stagePlan: columns.stagePlan, seeding: extensions?.seeding ?? null },
  };
}

/** Encode a v2 draft to the existing columns, with one owner per fact. */
export function encodeDraftSeasonRules(current: SeasonRuleColumns, input: DecodedSeasonRules): SeasonRuleColumnPatch {
  // The observed opening fact belongs to the lifecycle and is never writable here.
  void current;
  if (input.source !== "policy_v2") throw new Error("Only explicit v2 draft rules can be encoded");
  const policy = qualificationPolicyV2Schema.parse({ version: 2, educationRequired: input.participant.educationRequired, contacts: input.participant.contacts, competitiveProfileRequired: input.participant.competitiveProfileRequired, ...input.competitive });
  const extensions = seasonRuleExtensionsSchema.parse({ formation: input.formation.settings, seeding: input.competition.seeding, lineup: input.lineup.settings, rosterChanges: input.roster.changes });
  const teamRegistrationConfig: StoredTeamRegistrationConfigV2 = {
    requireUniqueTeamName: input.roster.requireUniqueTeamName,
    requireTeamLogo: input.roster.requireTeamLogo,
    requirePositions: input.roster.requirePositions,
    maxPerPositionPerTeam: input.roster.maxPerPositionPerTeam,
    ...extensions,
    qualificationPolicy: policy,
  };
  return {
    registrationMode: input.registration.registrationMode, registrationOpensAt: input.registration.registrationOpensAt, registrationClosesAt: input.registration.registrationClosesAt, registrationConfig: { ...input.registration.registrationConfig, allowedPlayerTypes: input.participant.allowedPlayerTypes ?? input.registration.registrationConfig.allowedPlayerTypes, rankThreshold: input.participant.rankThreshold ?? input.registration.registrationConfig.rankThreshold }, hasCaptainVoting: input.formation.hasCaptainVoting, hasDraft: input.formation.hasDraft,
    minTeamSize: input.roster.minTeamSize, maxTeamSize: input.roster.maxTeamSize, rosterChangeClosesAt: input.roster.rosterChangeClosesAt,
    affiliationRules: qualificationPolicySchema.shape.affiliationRules.parse(input.roster.affiliationRules), starterCount: input.lineup.starterCount, positions: input.roster.positions,
    stagePlan: input.competition.stagePlan, teamRegistrationConfig,
  };
}
