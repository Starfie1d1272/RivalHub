import { HONOR_STATE_LABELS } from "@/lib/postevent/presentation";
import { EmptyState, Panel, PosChip } from "@/components/rivalhub";
import { TeamProfileLink } from "./TeamProfileLink";
import { RecruitmentInterestButton } from "@/components/recruitment/RecruitmentInterestButton";
import type { PublicTeamProfile } from "@/lib/teams/public-profile";
import type { PublicLongTeamProfileReadModel } from "@/lib/teams/profile-read-model";
import { formatCSTShortDate } from "@/lib/utils/date";

export function TeamRecruitment({ team }: { team: PublicTeamProfile }) {
  const currentUserMembership = team.currentUserMembership;
  return <>{team.recruitment && <Panel label="正在招募" contentClassName="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><span className="text-sm text-[var(--color-fg-mid)]">需要位置</span>{team.recruitment.positions.length ? team.recruitment.positions.map((position) => <PosChip key={position} pos={position} />) : <span className="text-sm">位置不限</span>}</div>{team.recruitment.targetSeasonName && <p className="text-sm text-[var(--color-fg-mid)]">目标赛事 · {team.recruitment.targetSeasonName}</p>}{team.recruitment.note && <p className="max-w-2xl text-sm leading-6 text-[var(--color-fg-mid)]">{team.recruitment.note}</p>}<p className="text-xs text-[var(--color-fg-dim)]">更新于 {formatCSTShortDate(team.recruitment.updatedAt)}</p></div>{!currentUserMembership && <RecruitmentInterestButton recruitmentIntentId={team.recruitment.id} interested={team.viewerInterested} invited={team.viewerInvited} loggedIn={team.loggedIn} />}
        </div>
      </Panel>}</>;
}

export function TeamCareer({ career }: { career: PublicLongTeamProfileReadModel["career"] }) {
  return <section className="space-y-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">CAREER</p><h2 className="mt-1 text-lg font-semibold">赛事履历</h2></div>
            <div className="border-y border-[var(--color-border)]">
            {career.length > 0 ? (
              <div className="divide-y divide-[var(--color-border)]">
                {career.map((entry) => (
                  <TeamProfileLink key={entry.id} seasonSlug={entry.seasonSlug} entryId={entry.id} className="grid gap-3 px-5 py-4 hover:bg-[var(--color-panel-hi)] sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] sm:items-center">
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-semibold">{entry.seasonName}</span>
                      <span className="mt-1 block break-words text-xs text-[var(--color-fg-mid)]">{entry.name}</span>
                      {entry.honors.length > 0 && <span className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-xs font-medium text-[var(--color-accent)]">{entry.honors.map((honor) => <span key={honor}>{honor}</span>)}</span>}
                      {entry.honorHistory.length > 0 && <span className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-[var(--color-fg-dim)]">{entry.honorHistory.map((honor) => <span key={honor.id}>{honor.label} · {HONOR_STATE_LABELS[honor.state]}</span>)}</span>}
                    </span>
                    <span className="grid grid-cols-3 gap-3 text-xs tabular-nums text-[var(--color-fg-mid)]">
                      <span><span className="block text-[10px] uppercase tracking-wide text-[var(--color-fg-dim)]">Match</span><span className="mt-0.5 block font-medium text-[var(--color-fg)]">{entry.matchWins === null ? "—" : `${entry.matchWins}-${entry.matchLosses}`}</span></span>
                      <span><span className="block text-[10px] uppercase tracking-wide text-[var(--color-fg-dim)]">Map</span><span className="mt-0.5 block font-medium text-[var(--color-fg)]">{entry.mapWins === null ? "—" : `${entry.mapWins}-${entry.mapLosses}`}</span></span>
                      <span><span className="block text-[10px] uppercase tracking-wide text-[var(--color-fg-dim)]">Maps</span><span className="mt-0.5 block font-medium text-[var(--color-fg)]">{entry.maps ?? "—"}</span></span>
                    </span>
                    <span className="flex items-center justify-between gap-3 sm:justify-end">
                      <span className="text-xs font-medium text-[var(--color-fg-mid)]">{entry.placement ?? "完赛"}</span>
                      <span aria-hidden>→</span>
                    </span>
                  </TeamProfileLink>
                ))}
              </div>
            ) : <div className="p-5"><EmptyState title="尚无已结束赛事记录。" /></div>}
            </div>
          </section>;
}

export function TeamHistory({ team }: { team: PublicTeamProfile }) {
  return <section className="space-y-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">PROFILE</p><h2 className="mt-1 text-lg font-semibold">队伍资料</h2></div>


        <Panel label="队伍历史" contentClassName="p-5">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <h3 className="font-semibold">名称变更</h3>
              {team.nameChanges.length > 0 ? <div className="space-y-2">{team.nameChanges.map((change) => <p key={change.id} className="text-sm text-[var(--color-fg-mid)]">{change.oldName ? `${change.oldName} → ` : ""}{change.newName} · {formatCSTShortDate(change.changedAt)}</p>)}</div> : <p className="text-sm text-[var(--color-fg-mid)]">暂无变更记录</p>}
            </div>
            <div className="space-y-3">
              <h3 className="font-semibold">队长变更</h3>
              {team.captainChanges.length > 0 ? <div className="space-y-2">{team.captainChanges.map((change) => <p key={change.id} className="text-sm text-[var(--color-fg-mid)]">{change.name} · {formatCSTShortDate(change.changedAt)}</p>)}</div> : <p className="text-sm text-[var(--color-fg-mid)]">暂无变更记录</p>}
            </div>
          </div>
        </Panel>
      </section>;
}
