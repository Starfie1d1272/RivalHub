import { z } from "zod";
import { qualificationPolicySchema, qualificationPolicyV2Schema } from "@/lib/competition/qualification-policy";
import { normalizeAffiliationRules, normalizeRegistrationConfig, normalizeTeamRegistrationConfig, resolveQualificationPolicy, teamRegistrationConfigForWrite } from "@/lib/seasons/compatibility";
import type { Season, StoredTeamRegistrationConfigV2, QualificationPolicyV2 } from "@/types/season";
import type { QualificationFinding } from "@/lib/qualification/finding";
import type { ParticipantQualificationFacts } from "@/lib/qualification/facts";
import type { competitionEntries, competitionEntryRosterRevisions, competitionEntryParticipants } from "@/db/schema";

export type SeasonRuleColumns = Omit<Pick<Season, "registrationMode" | "hasCaptainVoting" | "hasDraft" | "registrationConfig" | "teamRegistrationConfig" | "affiliationRules" | "minTeamSize" | "maxTeamSize" | "starterCount" | "positions" | "stagePlan" | "registrationOpensAt" | "registrationClosesAt" | "rosterChangeClosesAt">, "teamRegistrationConfig"> & { teamRegistrationConfig: Season["teamRegistrationConfig"] | StoredTeamRegistrationConfigV2 };

const extensionSchema = z.object({
  formation: z.object({ captainSelection: z.enum(["vote", "admin"]), draftTimeoutSeconds: z.number().int().min(1), votesPerPerson: z.number().int().min(1), minimumVotesToConfirm: z.number().int().min(0) }).strict(),
  seeding: z.object({ mode: z.enum(["manual", "strength_recommendation"]) }).strict(),
  lineup: z.object({ maxSubstitutes: z.number().int().min(0) }).strict(),
  rosterChanges: z.object({ representativeCanRemove: z.boolean(), representativeCanTransfer: z.boolean(), selfServiceAfterApproval: z.boolean() }).strict(),
});

type V2Extensions = z.infer<typeof extensionSchema>;
export type ParticipantRules = Pick<QualificationPolicyV2, "educationRequired" | "contacts" | "competitiveProfileRequired"> & Pick<Season["registrationConfig"], "allowedPlayerTypes" | "rankThreshold">;
export type DecodedSeasonRules = {
  source: "legacy_solo" | "legacy_team" | "policy_v1" | "policy_v2";
  registration: Pick<SeasonRuleColumns, "registrationMode" | "registrationConfig" | "registrationOpensAt" | "registrationClosesAt">;
  formation: Pick<SeasonRuleColumns, "hasCaptainVoting" | "hasDraft"> & { settings: V2Extensions["formation"] | null };
  participant: ParticipantRules;
  roster: Pick<SeasonRuleColumns, "minTeamSize" | "maxTeamSize" | "affiliationRules"> & Pick<Season["teamRegistrationConfig"], "requirePositions" | "maxPerPositionPerTeam"> & { legacyParticipant: ParticipantRules | null; changes: V2Extensions["rosterChanges"] | null; rosterChangeClosesAt: SeasonRuleColumns["rosterChangeClosesAt"] };
  entry: Pick<Season["teamRegistrationConfig"], "requireUniqueTeamName" | "requireTeamLogo">;
  lineup: Pick<SeasonRuleColumns, "starterCount" | "positions"> & { settings: V2Extensions["lineup"] | null };
  competitive: Pick<QualificationPolicyV2, "competitiveProfile" | "externalStrengthGap">;
  competition: Pick<SeasonRuleColumns, "stagePlan"> & { seeding: V2Extensions["seeding"] | null };
};
export type SeasonRuleColumnPatch = Partial<SeasonRuleColumns>;
export type QualificationDecision = { state: "ready" | "blocked"; findings: readonly QualificationFinding[] };
export type CompetitiveEvidenceFacts = Pick<ParticipantQualificationFacts, "historicalPeak" | "seasonPeaks" | "platformSeasonOrder" | "fallbackFacts">;
/** Built server-side from the same transaction as the roster decision. */
export type RosterCandidate = {
  entry: Pick<typeof competitionEntries.$inferSelect, "id" | "competitionId" | "source" | "name" | "logoUrl" | "registrationStatus" | "currentRosterRevisionId" | "approvedRosterRevisionId">;
  revision: Pick<typeof competitionEntryRosterRevisions.$inferSelect, "id" | "entryId" | "revisionNumber" | "status" | "origin">;
  members: readonly {
    userId: string;
    participantId: string;
    facts: ParticipantQualificationFacts;
    commitment: typeof competitionEntryParticipants.$inferSelect.status;
    claim: { entryId: string; participantId: string } | null;
    isPrimaryStarter: boolean;
  }[];
};
export type EvaluateParticipant = (facts: ParticipantQualificationFacts, participantRules: ParticipantRules, evidence: CompetitiveEvidenceFacts | null) => QualificationDecision;
export type EvaluateRoster = (candidate: RosterCandidate, rules: Pick<DecodedSeasonRules, "participant" | "roster" | "lineup" | "entry">, evidence: ReadonlyMap<string, CompetitiveEvidenceFacts>) => QualificationDecision;
export type EvaluateLineup = (proposedLineup: RosterCandidate["members"], frozen: Pick<DecodedSeasonRules, "participant" | "roster" | "lineup" | "competitive">) => QualificationDecision;

/** Decode stored rows; v1 and historical checks remain distinguishable. */
export function decodeSeasonRules(columns: SeasonRuleColumns): DecodedSeasonRules {
  const raw = columns.teamRegistrationConfig as unknown as Record<string, unknown>;
  const stored = raw?.qualificationPolicy as { version?: unknown } | undefined;
  let policy: ReturnType<typeof qualificationPolicyV2Schema.parse>;
  let rosterPolicy: ReturnType<typeof qualificationPolicyV2Schema.parse>;
  let source: DecodedSeasonRules["source"];
  let affiliationRules = normalizeAffiliationRules(columns.affiliationRules);
  let extensions: V2Extensions | null = null;
  const registrationConfig = normalizeRegistrationConfig(columns.registrationConfig);
  const teamConfig = normalizeTeamRegistrationConfig(stored?.version === 2 ? { ...columns.teamRegistrationConfig, qualificationPolicy: undefined } : columns.teamRegistrationConfig as Season["teamRegistrationConfig"]);
  if (stored?.version === 2) {
    policy = qualificationPolicyV2Schema.parse(stored);
    rosterPolicy = policy;
    extensions = extensionSchema.parse(raw);
    source = "policy_v2";
  } else {
    if (stored && stored.version !== 1) throw new Error("Unsupported qualification policy version");
    const previous = stored ? qualificationPolicySchema.parse(stored) : resolveQualificationPolicy(columns.teamRegistrationConfig as Season["teamRegistrationConfig"], affiliationRules, "participant");
    const rosterPrevious = stored ? previous : resolveQualificationPolicy(columns.teamRegistrationConfig as Season["teamRegistrationConfig"], affiliationRules, "roster");
    if (stored) affiliationRules = normalizeAffiliationRules(previous.affiliationRules);
    policy = { version: 2, educationRequired: previous.educationRequired, contacts: previous.contacts, competitiveProfileRequired: previous.competitiveProfileRequired, competitiveProfile: previous.competitiveProfile, externalStrengthGap: previous.externalStrengthGap };
    rosterPolicy = { version: 2, educationRequired: rosterPrevious.educationRequired, contacts: rosterPrevious.contacts, competitiveProfileRequired: rosterPrevious.competitiveProfileRequired, competitiveProfile: rosterPrevious.competitiveProfile, externalStrengthGap: rosterPrevious.externalStrengthGap };
    source = stored ? "policy_v1" : columns.registrationMode === "solo" ? "legacy_solo" : "legacy_team";
  }
  return {
    source,
    registration: { registrationMode: columns.registrationMode, registrationConfig, registrationOpensAt: columns.registrationOpensAt, registrationClosesAt: columns.registrationClosesAt },
    formation: { hasCaptainVoting: extensions ? extensions.formation.captainSelection === "vote" : columns.hasCaptainVoting, hasDraft: columns.hasDraft, settings: extensions?.formation ?? null },
    participant: { educationRequired: policy.educationRequired, contacts: policy.contacts, competitiveProfileRequired: policy.competitiveProfileRequired, allowedPlayerTypes: registrationConfig.allowedPlayerTypes, rankThreshold: registrationConfig.rankThreshold },
    roster: { minTeamSize: columns.minTeamSize, maxTeamSize: columns.maxTeamSize, affiliationRules, requirePositions: teamConfig.requirePositions, maxPerPositionPerTeam: teamConfig.maxPerPositionPerTeam, legacyParticipant: source === "legacy_team" || source === "legacy_solo" ? { educationRequired: rosterPolicy.educationRequired, contacts: rosterPolicy.contacts, competitiveProfileRequired: rosterPolicy.competitiveProfileRequired, allowedPlayerTypes: registrationConfig.allowedPlayerTypes, rankThreshold: registrationConfig.rankThreshold } : null, changes: extensions?.rosterChanges ?? null, rosterChangeClosesAt: columns.rosterChangeClosesAt },
    entry: { requireUniqueTeamName: teamConfig.requireUniqueTeamName, requireTeamLogo: teamConfig.requireTeamLogo },
    lineup: { starterCount: columns.starterCount, positions: columns.positions, settings: extensions?.lineup ?? null },
    competitive: { competitiveProfile: policy.competitiveProfile, externalStrengthGap: policy.externalStrengthGap },
    competition: { stagePlan: columns.stagePlan, seeding: extensions?.seeding ?? null },
  };
}

/** Encode a v2 draft to the existing columns, with one owner per fact. */
export function encodeDraftSeasonRules(current: SeasonRuleColumns, input: DecodedSeasonRules): SeasonRuleColumnPatch {
  if (input.source !== "policy_v2") throw new Error("Only explicit v2 draft rules can be encoded");
  const policy = qualificationPolicyV2Schema.parse({ version: 2, educationRequired: input.participant.educationRequired, contacts: input.participant.contacts, competitiveProfileRequired: input.participant.competitiveProfileRequired, ...input.competitive });
  const extensions = extensionSchema.parse({ formation: input.formation.settings, seeding: input.competition.seeding, lineup: input.lineup.settings, rosterChanges: input.roster.changes });
  const rawTeam = { ...current.teamRegistrationConfig };
  Reflect.deleteProperty(rawTeam, "qualificationPolicy");
  const team = teamRegistrationConfigForWrite(normalizeTeamRegistrationConfig(rawTeam as Season["teamRegistrationConfig"]));
  for (const key of ["allowExternal", "graduateCountsAsHome", "minHomeMembers", "minEnrolledMembers", "maxExternalMembers", "requireCompetitiveProfile", "competitiveProfile"]) Reflect.deleteProperty(team, key);
  const teamRegistrationConfig: StoredTeamRegistrationConfigV2 = { ...team, ...input.entry, requirePositions: input.roster.requirePositions, maxPerPositionPerTeam: input.roster.maxPerPositionPerTeam, ...extensions, qualificationPolicy: policy };
  return {
    ...input.registration, registrationConfig: { ...input.registration.registrationConfig, allowedPlayerTypes: input.participant.allowedPlayerTypes, rankThreshold: input.participant.rankThreshold }, hasCaptainVoting: extensions.formation.captainSelection === "vote", hasDraft: input.formation.hasDraft,
    minTeamSize: input.roster.minTeamSize, maxTeamSize: input.roster.maxTeamSize, rosterChangeClosesAt: input.roster.rosterChangeClosesAt,
    affiliationRules: normalizeAffiliationRules(input.roster.affiliationRules), starterCount: input.lineup.starterCount, positions: input.lineup.positions,
    stagePlan: input.competition.stagePlan, teamRegistrationConfig,
  };
}
