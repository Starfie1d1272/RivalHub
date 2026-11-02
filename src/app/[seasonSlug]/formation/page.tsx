import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, competitionEntryParticipants, competitionEntryRosterMembers, competitionEntryRosterRevisions, eventRosters, seasons, users } from "@/db/schema";
import { Suspense } from "react";
import { redirect, notFound } from "next/navigation";
import { getUserSession } from "@/lib/auth/session";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { loadCompetitionEntryParticipantContext } from "@/lib/competition-entries/participant-context";
import { PageHeader, PageLayout, Panel } from "@/components/rivalhub";
import { decodeSeasonRules } from "@/lib/seasons/rules";
import { canChangeApprovedFormationRoster } from "@/lib/registration/window";
import { canSelfAdjustMajorRosterInTx } from "@/lib/major/roster-window";
import { canReleaseEliminatedParticipationInTx } from "@/lib/major/eliminated-entry";
import { FormationInvitations } from "@/components/draft/FormationInvitations";

export default function FormationPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  return <Suspense fallback={<PageLayout variant="standard"><p>正在读取编队邀请…</p></PageLayout>}><FormationContent params={params} /></Suspense>;
}
async function FormationContent({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season || season.registrationMode !== "solo") notFound();
  const session = await getUserSession();
  if (!session) redirect(`/login?next=/${seasonSlug}/formation`);
  const context = await loadCompetitionEntryParticipantContext({ competitionId: season.id, userId: session.userId });
  const currentSeason = (await db.query.seasons.findFirst({ where: eq(seasons.id, season.id) })) ?? notFound();
  const rules = decodeSeasonRules(currentSeason);
  async function capabilities(entry: NonNullable<typeof context.primaryEntry>) {
    const [revision, roster, phaseOpen, eliminated] = await Promise.all([
      db.query.competitionEntryRosterRevisions.findFirst({ where: eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId) }),
      db.query.eventRosters.findFirst({ where: eq(eventRosters.entryId, entry.id) }),
      db.transaction(tx => canSelfAdjustMajorRosterInTx(tx, currentSeason, entry.id)),
      canReleaseEliminatedParticipationInTx(db, currentSeason, entry.id),
    ]);
    const frozen = roster?.status === "frozen";
    const selfOpen = rules.roster.changes?.selfServiceAfterApproval !== false && canChangeApprovedFormationRoster(currentSeason, { source: entry.source, policyV2: rules.source === "policy_v2" }, "self") && phaseOpen;
    const draftOpen = revision?.origin === "initial" || (revision?.origin === "admin_remediation" ? canChangeApprovedFormationRoster(currentSeason, { source: entry.source, policyV2: rules.source === "policy_v2" }, "admin") && phaseOpen : selfOpen);
    return {
      respond: !frozen && revision?.status === "draft" && ["draft", "changes_requested"].includes(entry.registrationStatus) && draftOpen && ["registration", "drafting"].includes(currentSeason.status),
      withdraw: eliminated || (!frozen && phaseOpen && (entry.registrationStatus === "approved" ? selfOpen : revision?.origin === "admin_remediation" ? draftOpen : revision?.origin === "self_roster_change" ? selfOpen : true)),
      eliminated,
      transfer: !frozen && rules.roster.changes?.representativeCanTransfer !== false && (!entry.approvedRosterRevisionId || selfOpen),
    };
  }
  const invitations = await Promise.all(context.pendingInvitations.map(async invitation => {
    const entry = await db.query.competitionEntries.findFirst({ where: eq(competitionEntries.id, invitation.id) });
    return { ...invitation, position: invitation.position ?? null, canRespond: entry ? (await capabilities(entry)).respond : false };
  }));
  const active = context.activeClaimEntry;
  const representative = active?.representativeUserId === session.userId;
  const activeCapabilities = active ? await capabilities(active) : null;
  const candidates = representative && active ? await db.select({ id: users.id, name: users.displayName, perfectName: users.perfectName }).from(competitionEntryRosterMembers)
    .innerJoin(competitionEntryParticipants, eq(competitionEntryParticipants.id, competitionEntryRosterMembers.participantId))
    .innerJoin(users, eq(users.id, competitionEntryRosterMembers.userId))
    .where(and(eq(competitionEntryRosterMembers.revisionId, active.currentRosterRevisionId), eq(competitionEntryParticipants.status, "confirmed"))) : [];
  return <PageLayout variant="standard" className="space-y-6"><PageHeader title="我的编队" eyebrow={season.name} description="查看邀请并确认本届参赛队伍。" /><Panel contentClassName="p-5"><FormationInvitations invitations={invitations} activeEntry={context.activeClaimEntry ? { id: context.activeClaimEntry.id, name: context.activeClaimEntry.name, representative, canWithdraw: activeCapabilities?.withdraw ?? false, canRelease: activeCapabilities?.eliminated ?? false, canTransfer: activeCapabilities?.transfer ?? false, candidates: candidates.filter(candidate => candidate.id !== session.userId).map(candidate => ({ id: candidate.id, name: candidate.name || candidate.perfectName || "未命名选手" })) } : null} /></Panel></PageLayout>;
}
