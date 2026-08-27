import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { Separator } from "@/components/ui/separator";
import { Panel, StatusPill } from "@/components/rivalhub";
import { MatchStatusBadge } from "@/components/matches/MatchStatusBadge";
import { ScoreInput } from "@/components/matches/ScoreInput";
import { MapByMapInput } from "@/components/matches/MapByMapInput";
import { ScheduledAtInput } from "@/components/matches/ScheduledAtInput";
import { VetoInputDialog } from "@/components/matches/VetoInputDialog";
import { AdminRosterDialog } from "@/components/matches/AdminRosterDialog";
import { ResultCorrectionPanel } from "@/components/matches/ResultCorrectionPanel";
import { StatsOCRPanel } from "@/components/matches/StatsOCRPanel";
import { ForfeitButton } from "@/components/matches/ForfeitButton";
import { MapScoreCorrectInput } from "@/components/matches/MapScoreCorrectInput";
import { DeleteMatchButton } from "@/components/matches/DeleteMatchButton";
import { CompletedAtInput } from "@/components/matches/CompletedAtInput";
import { PreMatchOperatorChecklist } from "@/components/matches/PreMatchOperatorChecklist";
import { toCSTDateTimeInput } from "@/lib/utils/date";
import { MATCH_FORMAT_LABELS } from "@/types/match";

export interface TeamMemberData {
  id: string;
  teamId: string;
  steamName: string;
  displayName: string | null;
  perfectName: string | null;
  primaryPosition: string;
}

export interface RosterData {
  rosterId: string | null;
  starters: string[];
  substitutes: string[];
  status: string | null;
}

interface AdminMatchRowProps {
  match: {
    id: string;
    status: "scheduled" | "in_progress" | "finished" | "cancelled";
    format: "bo1" | "bo3" | "bo5";
    isForfeit: boolean;
    scoreA: number | null;
    scoreB: number | null;
    scheduledAt: Date | null;
    completionDeadline: Date | null;
    teamAId: string;
    teamBId: string;
    bracketNodeId: string | null;
    completedAt: Date | null;
  };
  teamAName: string;
  teamBName: string;
  seasonSlug: string;
  mapPool: string[];
  teamAMembers: TeamMemberData[];
  teamBMembers: TeamMemberData[];
  teamARoster: RosterData | null;
  teamBRoster: RosterData | null;
  completedMaps: {
    mapOrder: number;
    mapName: string;
    scoreA: number;
    scoreB: number;
    pickedByTeamId: string | null;
    teamAStartSide: "t" | "ct" | null;
  }[];
  pendingMaps: {
    mapOrder: number;
    mapName: string;
    pickedByTeamId: string | null;
    teamAStartSide: "t" | "ct" | null;
  }[];
  finishedMaps: { id: string; mapName: string; scoreA: number; scoreB: number }[];
}

export function AdminMatchRow({
  match,
  teamAName,
  teamBName,
  seasonSlug,
  mapPool,
  teamAMembers,
  teamBMembers,
  teamARoster,
  teamBRoster,
  completedMaps,
  pendingMaps,
  finishedMaps,
}: AdminMatchRowProps) {
  const startBlockers = [[teamAName, teamARoster], [teamBName, teamBRoster]].flatMap(([name, roster]) => {
    const typed = roster as RosterData | null;
    if (!typed) return [`${name} 尚未提交首发`];
    if (typed.starters.length !== 5) return [`${name} 当前不是 5 名首发`];
    if (typed.status !== "confirmed") return [`${name} 首发尚未确认`];
    return [];
  });
  return (
    <Panel
      pad={16}
      className={cn(
        "space-y-3",
        match.status === "in_progress" && "border-l-[3px] border-[var(--color-accent)]"
      )}
    >
      {/* Header: team names + score + badges */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="font-semibold">{teamAName}</span>
          <span className="text-[var(--color-fg-mid)]">
            {match.status === "finished"
              ? `${match.scoreA ?? 0} : ${match.scoreB ?? 0}`
              : "vs"}
          </span>
          <span className="font-semibold">{teamBName}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={MATCH_FORMAT_LABELS[match.format]} />
          <MatchStatusBadge
            status={match.status}
            isForfeit={match.isForfeit}
            scheduledAt={match.scheduledAt}
          />
        </div>
      </div>

      {match.status === "scheduled" && <><PreMatchOperatorChecklist teamA={{ name: teamAName, submitted: Boolean(teamARoster), confirmed: teamARoster?.status === "confirmed", starters: teamARoster?.starters.length ?? 0 }} teamB={{ name: teamBName, submitted: Boolean(teamBRoster), confirmed: teamBRoster?.status === "confirmed", starters: teamBRoster?.starters.length ?? 0 }} mapState={match.format === "bo1" ? "not_required" : completedMaps.length + pendingMaps.length > 0 ? "recorded" : "not_recorded"} /><p className="text-xs leading-5 text-[var(--color-fg-mid)]">默认宽限为 15 分钟，不会自动判负。延长宽限或重新排期请使用赛程时间；需要判负时请在下方“裁决与弃赛”记录原因。</p></>}

      {/* Operations */}
      {match.status !== "cancelled" && (
        <details open={match.status === "in_progress" ? true : undefined}>
          <summary className="cursor-pointer select-none list-none text-[11px] font-mono text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] py-1 transition-colors">
            {match.status === "finished" ? "▸ 数据录入" : "▸ 操作"}
          </summary>
          <div className="space-y-3 pt-2">
            <Separator />
            {match.status !== "finished" && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <AdminRosterDialog
                    matchId={match.id}
                    teamAName={teamAName}
                    teamBName={teamBName}
                    teamAId={match.teamAId}
                    teamBId={match.teamBId}
                    teamAMembers={teamAMembers}
                    teamBMembers={teamBMembers}
                    teamARoster={teamARoster}
                    teamBRoster={teamBRoster}
                  />
                  {(match.status === "scheduled" || match.status === "in_progress") && (
                    <VetoInputDialog
                      matchId={match.id}
                      format={match.format}
                      teamAName={teamAName}
                      teamBName={teamBName}
                      teamAId={match.teamAId}
                      teamBId={match.teamBId}
                      mapPool={mapPool}
                    />
                  )}
                </div>
                <ScheduledAtInput
                  matchId={match.id}
                  currentScheduledAt={match.scheduledAt}
                  currentCompletionDeadline={match.completionDeadline}
                />
                {(match.format === "bo3" || match.format === "bo5") && match.status === "in_progress" ? (
                  <MapByMapInput
                    matchId={match.id}
                    format={match.format}
                    teamAName={teamAName}
                    teamBName={teamBName}
                    teamAId={match.teamAId}
                    teamBId={match.teamBId}
                    completedMaps={completedMaps}
                    pendingMaps={pendingMaps}
                    mapPool={mapPool}
                  />
                ) : (
                  <ScoreInput
                    matchId={match.id}
                    teamAName={teamAName}
                    teamBName={teamBName}
                    currentStatus={match.status}
                    format={match.format}
                    startBlockers={startBlockers}
                  />
                )}
                <div className="space-y-2 border-t border-[var(--color-border)] pt-3"><p className="font-mono text-[11px] tracking-[0.12em] text-[var(--color-fg-mid)]">裁决与弃赛</p><p className="text-xs leading-5 text-[var(--color-fg-mid)]">延长、重新排期或双方协商可先调整赛程。判负必须明确弃赛方与原因，并由服务端写入正式结果与审计。</p><ForfeitButton
                  matchId={match.id}
                  teamAId={match.teamAId}
                  teamBId={match.teamBId}
                  teamAName={teamAName}
                  teamBName={teamBName}
                /></div>
              </>
            )}
            {match.status === "finished" && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <VetoInputDialog
                    matchId={match.id}
                    format={match.format}
                    teamAName={teamAName}
                    teamBName={teamBName}
                    teamAId={match.teamAId}
                    teamBId={match.teamBId}
                    mapPool={mapPool}
                    matchStatus="finished"
                  />
                </div>
                {finishedMaps.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-xs text-[var(--color-fg-mid)]">逐图比分（修改后大比分自动更新）</p>
                    {finishedMaps.map((map) => (
                      <MapScoreCorrectInput
                        key={map.id}
                        mapId={map.id}
                        mapName={map.mapName}
                        scoreA={map.scoreA}
                        scoreB={map.scoreB}
                        teamAName={teamAName}
                        teamBName={teamBName}
                      />
                    ))}
                  </div>
                ) : (
                  <ScoreInput
                    matchId={match.id}
                    teamAName={teamAName}
                    teamBName={teamBName}
                    currentStatus="finished"
                    format={match.format}
                    currentScoreA={match.scoreA}
                    currentScoreB={match.scoreB}
                  />
                )}
                <ResultCorrectionPanel
                  matchId={match.id}
                  teamAName={teamAName}
                  teamBName={teamBName}
                  format={match.format}
                />
                <CompletedAtInput
                  matchId={match.id}
                  initialValue={toCSTDateTimeInput(match.completedAt)}
                />
                {finishedMaps.map((map) => (
                  <div key={map.id}>
                    <StatsOCRPanel mapId={map.id} mapName={map.mapName} />
                  </div>
                ))}
              </>
            )}
          </div>
        </details>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/${seasonSlug}/matches/${match.id}`}
          className="text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors"
          target="_blank"
        >
          查看公开页 ↗
        </Link>
        {match.bracketNodeId == null && <DeleteMatchButton matchId={match.id} />}
      </div>
    </Panel>
  );
}
