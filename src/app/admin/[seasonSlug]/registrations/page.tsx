import { notFound } from "next/navigation";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, seasonRegistrations, users, registrationDrafts, teamApplicationMembers, teamApplications, educationVerifications, institutions } from "@/db/schema";
import { Marker } from "@/components/rivalhub";
import {
  RegistrationReviewList,
  type RegistrationRow,
} from "@/components/admin/RegistrationReviewList";
import { DraftRegistrationTable } from "@/components/admin/DraftRegistrationTable";
import { TeamApplicationReviewList } from "@/components/admin/TeamApplicationReviewList";
import { isTeamRegistration } from "@/lib/utils/season";
import { getParticipantReadinessBatch, resolveCompetitiveContext, type ParticipantReadiness } from "@/lib/qualification/service";
import { evaluateExternalStrengthRule, getPlayerStrengthBreakdown } from "@/lib/major/player-strength";
import { evaluateRosterEducationEligibility, resolveSeasonEducationVerification, type SeasonEducationVerification } from "@/lib/education/eligibility";
import { loadActiveSanctionsInTx } from "@/lib/discipline/service";
import { normalizeAffiliationRules, normalizeTeamRegistrationConfig } from "@/types/season";

interface PageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function AdminRegistrationsPage({ params }: PageProps) {
  const { seasonSlug } = await params;

  // 1. 查赛季
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  if (isTeamRegistration(season)) {
    const applications = await db
      .select({
        id: teamApplications.id,
        name: teamApplications.name,
        status: teamApplications.status,
        reviewReason: teamApplications.reviewReason,
        perfectTeamId: teamApplications.perfectTeamId,
        primaryStarterUserIds: teamApplications.primaryStarterUserIds,
        captainEmail: users.email,
      })
      .from(teamApplications)
      .innerJoin(users, eq(teamApplications.captainUserId, users.id))
      .where(eq(teamApplications.seasonId, season.id))
      .orderBy(desc(teamApplications.updatedAt));
    const applicationIds = applications.map((application) => application.id);
    const teamConfig = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
    const affiliationRules = normalizeAffiliationRules(season.affiliationRules);    const rawMembers = applicationIds.length === 0
      ? []
      : await db
          .select({ applicationId: teamApplicationMembers.applicationId, userId: users.id, email: users.email, displayName: users.displayName, perfectId: users.perfectId, emailVerifiedAt: users.emailVerifiedAt, educationVerificationId: educationVerifications.id, educationStatus: educationVerifications.status, academicStatus: educationVerifications.academicStatus, institutionName: institutions.name, institutionCode: institutions.moeInstitutionCode, educationSubmittedAt: educationVerifications.submittedAt, status: teamApplicationMembers.status })
          .from(teamApplicationMembers)
          .innerJoin(users, eq(teamApplicationMembers.userId, users.id))
          .leftJoin(educationVerifications, eq(educationVerifications.userId, users.id))
          .leftJoin(institutions, eq(educationVerifications.institutionId, institutions.id))
          .where(inArray(teamApplicationMembers.applicationId, applicationIds));
    const groupedMembers = new Map<string, { member: (typeof rawMembers)[number]; history: SeasonEducationVerification[] }>();
    for (const member of rawMembers) {
      const key = `${member.applicationId}:${member.userId}`;
      const current = groupedMembers.get(key) ?? { member, history: [] };
      if (member.educationVerificationId && member.educationStatus && member.academicStatus && member.institutionName) current.history.push({ id: member.educationVerificationId, status: member.educationStatus, academicStatus: member.academicStatus, institutionCode: member.institutionCode, institutionName: member.institutionName, submittedAt: member.educationSubmittedAt });
      groupedMembers.set(key, current);
    }
    const members = [...groupedMembers.values()].map(({ member, history }) => {
      const selected = resolveSeasonEducationVerification(history, affiliationRules).selectedVerification;
      return { ...member, educationVerificationId: selected?.id ?? null, educationStatus: selected?.status ?? null, academicStatus: selected?.academicStatus ?? null, institutionName: selected?.institutionName ?? null, institutionCode: selected?.institutionCode ?? null };
    });
    const allMemberIds = [...new Set(members.map((member) => member.userId))];
    const competitiveProfile = teamConfig.competitiveProfile ? await resolveCompetitiveContext(teamConfig.competitiveProfile) : null;
    const readinessByUser = teamConfig.requireCompetitiveProfile && competitiveProfile
      ? await getParticipantReadinessBatch(allMemberIds, competitiveProfile)
      : new Map<string, ParticipantReadiness>();
    const sanctionsByUser = await loadActiveSanctionsInTx(db, { seasonId: season.id, subjectUserIds: allMemberIds, effect: "registration_block" });
    const reviewRows = applications.map((application) => {
      const appMembers = members.filter((member) => member.applicationId === application.id);
      const confirmed = appMembers.filter((member) => member.status === "confirmed");
      const education = evaluateRosterEducationEligibility(confirmed.map((member) => ({ userId: member.userId, email: member.email, emailVerifiedAt: member.emailVerifiedAt, verification: member.educationVerificationId && member.educationStatus && member.academicStatus && member.institutionName ? { id: member.educationVerificationId, status: member.educationStatus, academicStatus: member.academicStatus, institutionCode: member.institutionCode, institutionName: member.institutionName } : null })), affiliationRules);
      const primary = application.primaryStarterUserIds.map((userId) => appMembers.find((member) => member.userId === userId)).filter((member): member is typeof appMembers[number] => Boolean(member));
      const hasStrengthFacts = Boolean(competitiveProfile) && primary.length === 5 && primary.every((member) => {
        const readiness = readinessByUser.get(member.userId);
        return readiness ? getPlayerStrengthBreakdown(readiness.strength, competitiveProfile!).available : false;
      });
      const external = !competitiveProfile || primary.length !== 5 || !hasStrengthFacts ? { state: "pending" as const, eligible: false, blockers: [] } : (() => {
        const verdict = evaluateExternalStrengthRule({ config: competitiveProfile, players: primary.map((member) => {
        const readiness = readinessByUser.get(member.userId);
        const isNju = Boolean(member.institutionCode && member.academicStatus && affiliationRules.some((rule) => rule.institutionCode === member.institutionCode && rule.eligibleAcademicStatuses.includes(member.academicStatus as "enrolled" | "graduated")));
        return { ...(readiness?.strength ?? { userId: member.userId, label: member.displayName ?? member.email, historicalPeak: null, previousSeasonPeak: null, currentSeasonPeak: null }), isHome: isNju };
        }) });
        return { state: verdict.eligible ? "complete" as const : "blocked" as const, ...verdict };
      })();
      const readinessBlocked = confirmed.filter((member) => !readinessByUser.get(member.userId)?.ready);
      const disciplineBlocked = confirmed.filter((member) => (sanctionsByUser.get(member.userId)?.length ?? 0) > 0);
      return { ...application, members: appMembers.map((member) => {
        const readiness = readinessByUser.get(member.userId); const strength = readiness && competitiveProfile ? getPlayerStrengthBreakdown(readiness.strength, competitiveProfile) : null;
        const isNju = Boolean(member.institutionCode && member.academicStatus && affiliationRules.some((rule) => rule.institutionCode === member.institutionCode && rule.eligibleAcademicStatuses.includes(member.academicStatus as "enrolled" | "graduated")));
        return { userId: member.userId, email: member.email, displayName: member.displayName, perfectId: member.perfectId, emailVerified: Boolean(member.emailVerifiedAt), educationStatus: (member.educationStatus ?? "unsubmitted") as "unsubmitted" | "pending" | "approved" | "rejected", institutionName: member.institutionName, institutionCode: member.institutionCode, status: member.status, readinessBlockers: readiness?.blockers ?? (teamConfig.requireCompetitiveProfile ? ["竞技平台赛季目录不可用。"] : []), disciplineBlocked: (sanctionsByUser.get(member.userId)?.length ?? 0) > 0, strength: strength ? { summary: strength.available ? `综合段位参考值 ${strength.weightedRank?.toFixed(2) ?? "—"}；历史 / 上赛季 / 当前：${strength.historicalValue} / ${strength.previousValue} / ${strength.currentValue}` : "资料不可比较", blockers: strength.blockers } : null, isNju };
      }), qualification: { readiness: { state: readinessBlocked.length === 0 ? "complete" as const : "blocked" as const, detail: readinessBlocked.length === 0 ? "已确认成员的参赛资料齐全" : `${readinessBlocked.length} 名已确认成员仍有参赛资料需要完善` }, education: { state: education.eligible ? "complete" as const : "blocked" as const, detail: education.eligible ? `教育认证与南京大学成员要求已满足` : education.blockers.join(" ") }, externalStrength: { state: external.state, detail: external.state === "pending" ? "选定 5 名预定主力后检查成员资格。" : external.eligible ? "预定主力外校成员实力限制通过" : external.blockers.join(" ") }, discipline: { state: disciplineBlocked.length === 0 ? "complete" as const : "blocked" as const, detail: disciplineBlocked.length === 0 ? "已确认成员无有效报名禁赛处罚" : `${disciplineBlocked.length} 名已确认成员存在有效报名禁赛处罚` } } };
    });
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6"><Marker sub={`${applications.length} 支报名队伍 · 赛季状态：${season.status}`}>队伍报名审核 · {season.name}</Marker></div>
        <TeamApplicationReviewList applications={reviewRows} />
      </div>
    );
  }

  // 2. 并行查报名记录 + 草稿
  const [rows, drafts] = await Promise.all([
    db
      .select({
        id: seasonRegistrations.id,
        primaryPosition: seasonRegistrations.primaryPosition,
        secondaryPosition: seasonRegistrations.secondaryPosition,
        peakRank: seasonRegistrations.peakRank,
        peakRankSeason: seasonRegistrations.peakRankSeason,
        peakRating: seasonRegistrations.peakRating,
        currentSeasonPeakRank: seasonRegistrations.currentSeasonPeakRank,
        currentRating: seasonRegistrations.currentRating,
        screenshotUrls: seasonRegistrations.screenshotUrls,
        mapPreferences: seasonRegistrations.mapPreferences,
        gameplayStyle: seasonRegistrations.gameplayStyle,
        competitionHistory: seasonRegistrations.competitionHistory,
        notes: seasonRegistrations.notes,
        willingToBeCaptain: seasonRegistrations.willingToBeCaptain,
        status: seasonRegistrations.status,
        createdAt: seasonRegistrations.createdAt,
        email: users.email,
        studentId: users.studentId,
        steamName: users.steamName,
        displayName: users.displayName,
        perfectName: users.perfectName,
        steam64: users.steam64,
        steamProfileUrl: users.steamProfileUrl,
        qq: users.qq,
      })
      .from(seasonRegistrations)
      .leftJoin(users, eq(seasonRegistrations.userId, users.id))
      .where(eq(seasonRegistrations.seasonId, season.id))
      .orderBy(asc(seasonRegistrations.createdAt)),
    db
      .select()
      .from(registrationDrafts)
      .where(eq(registrationDrafts.seasonId, season.id))
      .orderBy(desc(registrationDrafts.updatedAt)),
  ]);

  const registrations: RegistrationRow[] = rows.map((r) => ({
    ...r,
    status: r.status ?? "pending",
    email: r.email ?? "",
    screenshotUrls: r.screenshotUrls ?? [],
    mapPreferences: r.mapPreferences ?? [],
    createdAt: r.createdAt?.toISOString() ?? "",
    competitionHistory: r.competitionHistory ?? null,
    notes: r.notes ?? null,
    studentId: r.studentId ?? null,
    steamName: r.steamName ?? null,
    displayName: r.displayName ?? null,
    perfectName: r.perfectName ?? null,
    steam64: r.steam64 ?? null,
    steamProfileUrl: r.steamProfileUrl ?? null,
    qq: r.qq ?? null,
  }));

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="mb-6">
        <Marker sub={`${registrations.length} 份已提交 · ${drafts.length} 份草稿 · 赛季状态：${season.status}`}>报名审核 · {season.name}</Marker>
      </div>

      <RegistrationReviewList registrations={registrations} />

      <DraftRegistrationTable drafts={drafts} />
    </div>
  );
}
