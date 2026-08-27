import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { educationVerifications, institutions, seasons, seasonRegistrations, teamApplicationMembers, teamApplications, users } from "@/db/schema";
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
import { TeamApplicationFlow } from "@/components/register/TeamApplicationFlow";

export const dynamic = "force-dynamic";

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
    const applicationRows = await db
      .select({
        id: teamApplications.id,
        name: teamApplications.name,
        logoUrl: teamApplications.logoUrl,
        captainUserId: teamApplications.captainUserId,
        status: teamApplications.status,
        reviewReason: teamApplications.reviewReason,
      })
      .from(teamApplications)
      .innerJoin(teamApplicationMembers, eq(teamApplicationMembers.applicationId, teamApplications.id))
      .where(and(eq(teamApplications.seasonId, season.id), eq(teamApplicationMembers.userId, userSession.userId)))
      .orderBy(desc(teamApplications.updatedAt))
      .limit(1);
    const application = applicationRows[0] ?? null;
    const memberRows = application
      ? await db
          .select({
            id: teamApplicationMembers.id,
            userId: teamApplicationMembers.userId,
            email: users.email,
            displayName: users.displayName,
            emailVerified: users.emailVerifiedAt,
            verificationStatus: educationVerifications.status,
            institutionName: institutions.name,
            verificationSubmittedAt: educationVerifications.submittedAt,
            status: teamApplicationMembers.status,
          })
          .from(teamApplicationMembers)
          .innerJoin(users, eq(teamApplicationMembers.userId, users.id))
          .leftJoin(educationVerifications, eq(educationVerifications.userId, users.id))
          .leftJoin(institutions, eq(educationVerifications.institutionId, institutions.id))
          .where(eq(teamApplicationMembers.applicationId, application.id))
          .orderBy(teamApplicationMembers.createdAt)
      : [];
    // Approved education assertions are historical and a member may have more
    // than one.  The roster UI still represents one person, never one row per
    // assertion.
    const memberByUser = new Map<string, (typeof memberRows)[number]>();
    for (const member of memberRows) {
      const current = memberByUser.get(member.userId);
      const shouldReplace = !current
        || (member.verificationStatus === "approved" && current.verificationStatus !== "approved")
        || (member.verificationStatus === current.verificationStatus
          && (member.verificationSubmittedAt?.getTime() ?? 0) > (current.verificationSubmittedAt?.getTime() ?? 0));
      if (shouldReplace) memberByUser.set(member.userId, member);
    }
    const members = [...memberByUser.values()];

    return (
      <div className="container mx-auto max-w-2xl space-y-6 px-4 py-10">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-accent)]">{season.name} · TEAM REGISTER</p>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-fg)]">队伍报名</h1>
        </div>
        <StatusBanner
          tone={getWindowTone(registrationWindow.phase, registrationWindow.canSubmit)}
          title={registrationWindow.message}
          sub="报名申请与正式参赛队伍分离；只有管理员审核通过后才会生成正式队伍。"
        />
        <TeamApplicationFlow
          seasonId={season.id}
          seasonName={season.name}
          currentUserId={userSession.userId}
          minTeamSize={season.minTeamSize}
          maxTeamSize={season.maxTeamSize}
          application={application}
          members={members.map((member) => ({ id: member.id, userId: member.userId, email: member.email, displayName: member.displayName, status: member.status, emailVerified: Boolean(member.emailVerified), educationStatus: member.verificationStatus ?? "unsubmitted", institutionName: member.institutionName }))}
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
                    {full && <span className="ml-1">FULL</span>}
                  </div>
                </div>
              );
            })}
            <div className="flex justify-between items-center pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-fg-dim)", fontFamily: "var(--font-display)" }}>
                Approved
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
