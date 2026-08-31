import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  competitionEntryParticipants,
  competitionEntryRosterMembers,
  competitionEntryRosterRevisions,
  seasons,
  seasonRegistrations,
  teamMemberships,
  teams,
  userCompetitiveRoles,
  users,
} from "@/db/schema";
import { getPositionCounts, getApprovedCount } from "@/actions/register";
import { RegistrationForm } from "@/components/register/RegistrationForm";
import { normalizeRegistrationConfig } from "@/types/season";
import { REGISTRATION_STATUS_LABELS } from "@/types/registration";
import { Panel, StatusBanner, PosChip } from "@/components/rivalhub";
import { positionLabel } from "@/lib/validators/registration";
import { getRegistrationWindowState, getWindowTone } from "@/lib/registration/window";
import { formatCST } from "@/lib/utils/date";
import { getUserSession } from "@/lib/auth/session";
import { isSoloRegistration } from "@/lib/utils/season";
import { isTeamRegistration } from "@/lib/utils/season";
import { CompetitionEntryFlow } from "@/components/register/CompetitionEntryFlow";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getParticipantReadinessBatch } from "@/lib/qualification/service";
import { normalizeTeamRegistrationConfig } from "@/types/season";

interface RegisterPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export async function generateMetadata({ params }: RegisterPageProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  return { title: season ? `报名 · ${season.name}` : "报名" };
}

export default async function RegisterPage({ params }: RegisterPageProps) {
  const { seasonSlug } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  if (!isSoloRegistration(season) && !isTeamRegistration(season)) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-2xl">
        <Panel pad={40}>
          <StatusBanner
            tone="info"
            title={season.name}
            sub="队伍报名尚未开放，请联系赛事管理员。"
          />
        </Panel>
      </div>
    );
  }

  // 报名未开放时显示状态提示
  if (season.status !== "registration") {
    const statusMessages: Record<string, string> = {
      draft:    "报名尚未开放，请关注后续公告。",
      voting:   "报名已截止，现在是队长投票阶段。",
      drafting: "报名已截止，现在是选秀阶段。",
      playing:  "报名已截止，赛季正在进行中。",
      finished: "该赛季已结束。",
      archived: "该赛季已归档。",
    };
    return (
      <div className="container mx-auto px-4 py-16 max-w-2xl">
        <Panel pad={40}>
        <div className="text-center">
          <StatusBanner
            tone="info"
            title={season.name}
            sub={statusMessages[season.status] ?? "报名通道当前不可用。"}
          />
        </div>
      </Panel>
      </div>
    );
  }

  const registrationWindow = getRegistrationWindowState(season);
  const userSession = await getUserSession();
  if (!userSession) {
    redirect(`/login?next=/${seasonSlug}/register`);
  }

  if (isTeamRegistration(season)) {
    const [captainedTeams, entryRows] = await Promise.all([
      db.select({ id: teams.id, name: teams.name }).from(teams)
        .where(and(eq(teams.status, "active"), eq(teams.captainUserId, userSession.userId)))
        .orderBy(teams.name),
      db.select({ entry: competitionEntries })
        .from(competitionEntries)
        .leftJoin(competitionEntryParticipants, eq(competitionEntryParticipants.entryId, competitionEntries.id))
        .where(and(
          eq(competitionEntries.competitionId, season.id),
          or(eq(competitionEntries.representativeUserId, userSession.userId), eq(competitionEntryParticipants.userId, userSession.userId)),
        ))
        .orderBy(desc(competitionEntries.updatedAt))
        .limit(1),
    ]);
    const entry = entryRows[0]?.entry ?? null;
    let entryView: Parameters<typeof CompetitionEntryFlow>[0]["entry"] = null;
    if (entry) {
      const [revision] = await db.select({ id: competitionEntryRosterRevisions.id })
        .from(competitionEntryRosterRevisions)
        .where(and(eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId), eq(competitionEntryRosterRevisions.entryId, entry.id)))
        .limit(1);
      const candidateRows = entry.teamId
        ? await db.select({ membershipId: teamMemberships.id, userId: teamMemberships.userId, status: teamMemberships.status, email: users.email, displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName })
            .from(teamMemberships).innerJoin(users, eq(users.id, teamMemberships.userId))
            .where(and(eq(teamMemberships.teamId, entry.teamId), isNull(teamMemberships.endedAt), inArray(teamMemberships.status, ["active", "benched"])))
        : [];
      const rosterRows = revision
        ? await db.select({ participantId: competitionEntryParticipants.id, userId: competitionEntryRosterMembers.userId, confirmation: competitionEntryParticipants.status, primary: competitionEntryRosterMembers.isPrimaryStarter, membershipId: competitionEntryRosterMembers.teamMembershipId, email: users.email, displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName, membershipStatus: teamMemberships.status })
            .from(competitionEntryRosterMembers)
            .innerJoin(competitionEntryParticipants, eq(competitionEntryParticipants.id, competitionEntryRosterMembers.participantId))
            .innerJoin(users, eq(users.id, competitionEntryRosterMembers.userId))
            .leftJoin(teamMemberships, eq(teamMemberships.id, competitionEntryRosterMembers.teamMembershipId))
            .where(eq(competitionEntryRosterMembers.revisionId, revision.id))
        : [];
      const userIds = [...new Set([...candidateRows.map((row) => row.userId), ...rosterRows.map((row) => row.userId)])];
      const teamConfig = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
      const readinessByUser = teamConfig.requireCompetitiveProfile && teamConfig.competitiveProfile
        ? await getParticipantReadinessBatch(userIds, teamConfig.competitiveProfile)
        : new Map();
      const roleRows = userIds.length ? await db.select({ userId: userCompetitiveRoles.userId, role: userCompetitiveRoles.role, isPrimary: userCompetitiveRoles.isPrimary }).from(userCompetitiveRoles).where(inArray(userCompetitiveRoles.userId, userIds)) : [];
      const rolesByUser = new Map<string, Array<(typeof roleRows)[number]["role"]>>();
      const primaryRoleByUser = new Map<string, (typeof roleRows)[number]["role"]>();
      for (const role of roleRows) {
        rolesByUser.set(role.userId, [...(rolesByUser.get(role.userId) ?? []), role.role]);
        if (role.isPrimary) primaryRoleByUser.set(role.userId, role.role);
      }
      const candidates = candidateRows.map((row) => ({ membershipId: row.membershipId, userId: row.userId, label: getPublicDisplayName(row), status: row.status as "active" | "benched", roles: rolesByUser.get(row.userId) ?? [], primaryRole: primaryRoleByUser.get(row.userId) ?? null, readiness: readinessByUser.get(row.userId) }));
      entryView = {
        id: entry.id,
        name: entry.name,
        status: entry.registrationStatus,
        representativeUserId: entry.representativeUserId,
        perfectTeamId: entry.perfectTeamId,
        reviewReason: entry.reviewReason,
        candidates,
        roster: rosterRows.map((row) => ({
          participantId: row.participantId,
          membershipId: row.membershipId ?? `historical:${row.participantId}`,
          userId: row.userId,
          label: getPublicDisplayName(row),
          status: row.membershipStatus === "benched" ? "benched" as const : "active" as const,
          roles: rolesByUser.get(row.userId) ?? [],
          primaryRole: primaryRoleByUser.get(row.userId) ?? null,
          confirmation: row.confirmation,
          primary: row.primary,
          readiness: readinessByUser.get(row.userId),
        })),
      };
    }

    return (
      <div className="container mx-auto max-w-2xl space-y-6 px-4 py-10">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)]">{season.name} · TEAM REGISTER</p>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-fg)]">队伍报名</h1>
        </div>
        <StatusBanner
          tone={getWindowTone(registrationWindow.phase, registrationWindow.canSubmit)}
          title={registrationWindow.message}
          sub="审核通过后，报名名单将锁定；赛前还会确认独立的正式参赛名单。"
        />
        <CompetitionEntryFlow
          competitionId={season.id}
          competitionName={season.name}
          currentUserId={userSession.userId}
          minRoster={season.minTeamSize}
          maxRoster={season.maxTeamSize}
      starterCount={season.starterCount}
      requiresPerfectTeamId={season.teamRegistrationConfig?.requireCompetitiveProfile ?? false}
          captainedTeams={captainedTeams}
          entry={entryView}
        />
      </div>
    );
  }

  const [positionCounts, approvedCount, currentRegistration, currentUser] = await Promise.all([
    getPositionCounts(season.id),
    getApprovedCount(season.id),
    db.query.seasonRegistrations.findFirst({
      where: and(
        eq(seasonRegistrations.seasonId, season.id),
        eq(seasonRegistrations.userId, userSession.userId),
      ),
    }),
    db.query.users.findFirst({
      where: eq(users.id, userSession.userId),
    }),
  ]);
  const regConfig = normalizeRegistrationConfig(season.registrationConfig);
  const maxPerPos = regConfig.maxPerPosition;
  const existingStatus = currentRegistration?.status ?? null;
  const existingStatusLabel = existingStatus ? REGISTRATION_STATUS_LABELS[existingStatus] : null;
  const canEditExisting = !!currentRegistration && currentRegistration.status !== "approved";
  const initialValues = currentRegistration
    ? {
        email: userSession.email,
        studentId: currentUser?.studentId ?? "",
        qq: currentUser?.qq ?? "",
        perfectName: currentUser?.perfectName ?? "",
        steamName: currentUser?.steamName ?? "",
        steam64: currentUser?.steam64 ?? "",
        steamProfileUrl: currentUser?.steamProfileUrl ?? "",
        playerType: currentRegistration.playerType,
        primaryPosition: currentRegistration.primaryPosition,
        secondaryPosition: currentRegistration.secondaryPosition,
        peakRank: currentRegistration.peakRank,
        peakRankSeason: currentRegistration.peakRankSeason,
        peakRating: currentRegistration.peakRating,
        peakWe: currentRegistration.peakWe ?? undefined,
        currentSeasonPeakRank: currentRegistration.currentSeasonPeakRank,
        currentRating: currentRegistration.currentRating,
        currentWe: currentRegistration.currentWe ?? undefined,
        screenshotUrls: currentRegistration.screenshotUrls,
        mapPreferences: currentRegistration.mapPreferences,
        gameplayStyle: currentRegistration.gameplayStyle,
        competitionHistory: currentRegistration.competitionHistory ?? "",
        highlightVideoUrl: currentRegistration.highlightVideoUrl ?? "",
        willingToBeCaptain: currentRegistration.willingToBeCaptain,
        notes: currentRegistration.notes ?? "",
        antiCheatPledge: true as const,
      }
    : undefined;

  // 位置容量数据
  const capacityEntries = season.positions.map((pos) => {
    const cur = positionCounts[pos] ?? 0;
    const label = positionLabel(pos);
    return { pos, label, cur, max: maxPerPos };
  });

  return (
    <div className="container mx-auto px-4 py-10 max-w-2xl space-y-6">
      <div className="mb-8">
        <p className="font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)] uppercase mb-1">
          {season.name} · REGISTER
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-fg)]">报名参赛</h1>
      </div>

      {/* 位置实时容量 */}
      <div>
        <StatusBanner
          tone={getWindowTone(registrationWindow.phase, registrationWindow.canSubmit)}
          title={registrationWindow.message}
          sub={[
            season.startAt ? `报名开始：${formatCST(season.startAt)}` : "报名开始：发布后立即开放",
            season.registrationDeadline ? `报名截止：${formatCST(season.registrationDeadline)}` : "报名截止：未设置",
          ].join(" · ")}
        />
      </div>

      <div>
        <Panel label="实时容量">
          <div className="grid gap-2.5">
            {capacityEntries.map(({ pos, label, cur, max }) => {
              const pct = Math.min((cur / max) * 100, 100);
              const full = cur >= max;
              const warn = !full && pct > 80;
              return (
                <div key={pos} className="grid items-center gap-3 grid-cols-[48px_1fr_48px] sm:grid-cols-[72px_1fr_72px]">
                  <PosChip pos={label} />
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: full ? "var(--color-danger)" : warn ? "var(--color-warn)" : "var(--color-accent)",
                      }}
                    />
                  </div>
                  <div
                    className="text-right font-bold"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: full ? "var(--color-danger)" : "var(--color-fg-mid)",
                    }}
                  >
                    {cur} / {max}
                    {full && <span className="ml-1">已满</span>}
                  </div>
                </div>
              );
            })}
            <div className="flex justify-between items-center pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-fg-dim)", fontFamily: "var(--font-display)" }}>
                已通过
              </span>
              <span className="font-bold" style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--color-fg)" }}>
                {approvedCount} / {regConfig.maxTotal}
              </span>
            </div>
          </div>
        </Panel>
      </div>

      {currentRegistration && (
        <div>
          <StatusBanner
            tone={currentRegistration.status === "approved" ? "success" : currentRegistration.status === "rejected" ? "warn" : "info"}
            title={`你的报名状态：${existingStatusLabel}`}
            sub={
              currentRegistration.status === "approved"
                ? "审核已通过，报名信息已锁定。如确需调整请联系管理员。"
                : "你可以在下方修改已提交的信息；重新提交后状态会回到待审核。"
            }
          />
        </div>
      )}

      <Panel pad={24}>
        {currentRegistration?.status === "approved" ? (
          <div className="py-10 text-center">
            <h2 className="text-xl font-bold text-[var(--color-fg)]">报名已通过</h2>
            <p className="mt-2 text-sm text-[var(--color-fg-mid)]">
              你已经进入本赛季名单，审核通过后暂不支持自行修改报名信息。
            </p>
          </div>
        ) : (
          <RegistrationForm
            seasonId={season.id}
            seasonName={season.name}
            positionCounts={positionCounts}
            positions={season.positions}
            registrationConfig={regConfig}
            windowState={registrationWindow}
            currentUserEmail={userSession?.email ?? null}
            initialValues={initialValues}
            submitLabel={canEditExisting ? "更新报名" : undefined}
          />
        )}
      </Panel>

      <p className="text-xs text-[var(--color-fg-dim)] text-center mt-6">
        提交即视为同意参赛规则。审核通过前可自行修改；审核通过后如需更改请联系管理员。
      </p>
    </div>
  );
}
