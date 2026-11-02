import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntryParticipants, competitionEntryRosterMembers, users } from "@/db/schema";
import { Suspense } from "react";
import { redirect, notFound } from "next/navigation";
import { getUserSession } from "@/lib/auth/session";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { loadCompetitionEntryParticipantContext } from "@/lib/competition-entries/participant-context";
import { PageHeader, PageLayout, Panel } from "@/components/rivalhub";
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
  const invitations = context.pendingInvitations.map((entry) => ({ ...entry, position: entry.position ?? null }));
  const active = context.activeClaimEntry;
  const representative = active?.representativeUserId === session.userId;
  const candidates = representative && active ? await db.select({ id: users.id, name: users.displayName, perfectName: users.perfectName }).from(competitionEntryRosterMembers)
    .innerJoin(competitionEntryParticipants, eq(competitionEntryParticipants.id, competitionEntryRosterMembers.participantId))
    .innerJoin(users, eq(users.id, competitionEntryRosterMembers.userId))
    .where(and(eq(competitionEntryRosterMembers.revisionId, active.currentRosterRevisionId), eq(competitionEntryParticipants.status, "confirmed"))) : [];
  return <PageLayout variant="standard" className="space-y-6"><PageHeader title="我的编队" eyebrow={season.name} description="查看邀请并确认本届参赛队伍。" /><Panel contentClassName="p-5"><FormationInvitations invitations={invitations} activeEntry={context.activeClaimEntry ? { id: context.activeClaimEntry.id, name: context.activeClaimEntry.name, representative, candidates: candidates.filter(candidate => candidate.id !== session.userId).map(candidate => ({ id: candidate.id, name: candidate.name || candidate.perfectName || "未命名选手" })) } : null} /></Panel></PageLayout>;
}
