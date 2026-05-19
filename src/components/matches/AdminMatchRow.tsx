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
import { StatsOCRPanel } from "@/components/matches/StatsOCRPanel";
import { DeleteMatchButton } from "@/components/matches/DeleteMatchButton";
import { CompletedAtInput } from "@/components/matches/CompletedAtInput";
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
  starters: string[];
  substitutes: string[];
  status: string | null;
}

interface AdminMatchRowProps {
  match: {
    id: string;
    status: "scheduled" | "in_progress" | "finished" | "cancelled";
    format: "bo1" | "bo3" | "bo5";
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
  isPlayoff?: boolean;
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
  finishedMaps: { id: string; mapName: string }[];
}

export function AdminMatchRow({
  match,
  teamAName,
  teamBName,
  seasonSlug,
  mapPool,
  isPlayoff = false,
  teamAMembers,
  teamBMembers,
  teamARoster,
  teamBRoster,
  completedMaps,
  pendingMaps,
  finishedMaps,
}: AdminMatchRowProps) {
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
          />
        </div>
      </div>

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
                {isPlayoff && match.status === "in_progress" ? (
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
                  />
                )}
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
                <ScoreInput
                  matchId={match.id}
                  teamAName={teamAName}
                  teamBName={teamBName}
                  currentStatus="finished"
                  format={match.format}
                  currentScoreA={match.scoreA}
                  currentScoreB={match.scoreB}
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
