import { Suspense } from "react";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, competitionEntryRosterMembers } from "@/db/schema";
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
  const invitationIds = context.pendingInvitations.map((entry) => entry.id);
  const positions = invitationIds.length ? await db.select({ entryId: competitionEntries.id, position: competitionEntryRosterMembers.primaryPosition })
    .from(competitionEntries).innerJoin(competitionEntryRosterMembers, eq(competitionEntryRosterMembers.revisionId, competitionEntries.currentRosterRevisionId))
    .where(and(inArray(competitionEntries.id, invitationIds), eq(competitionEntryRosterMembers.userId, session.userId))) : [];
  const positionsByEntry = new Map(positions.map((row) => [row.entryId, row.position]));
  const invitations = context.pendingInvitations.map((entry) => ({ ...entry, position: positionsByEntry.get(entry.id) ?? null }));
  return <PageLayout variant="standard" className="space-y-6"><PageHeader title="我的编队" eyebrow={season.name} description="查看邀请并确认本届参赛队伍。" /><Panel contentClassName="p-5"><FormationInvitations invitations={invitations} activeEntry={context.activeClaimEntry ? { id: context.activeClaimEntry.id, name: context.activeClaimEntry.name } : null} /></Panel></PageLayout>;
}
