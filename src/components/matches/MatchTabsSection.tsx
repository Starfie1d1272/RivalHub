import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MatchCard } from "@/components/matches/MatchCard";
import { isMatchFormat, isMatchStatus } from "@/types/match";

interface MatchRow {
  id: string;
  teamAId: string;
  teamBId: string;
  scoreA: number | null;
  scoreB: number | null;
  format: string;
  status: string;
  scheduledAt: Date | null;
  completedAt: Date | null;
}

interface MatchTabsSectionProps {
  activeMatches: MatchRow[];
  doneMatches: MatchRow[];
  stage: string;
  seasonSlug: string;
  teamMap: Map<string, string>;
  /** 队伍名未找到时的 fallback 文案，默认"未知队伍" */
  unknownTeamName?: string;
}

export function MatchTabsSection({
  activeMatches,
  doneMatches,
  stage,
  seasonSlug,
  teamMap,
  unknownTeamName = "未知队伍",
}: MatchTabsSectionProps) {
  return (
    <Tabs defaultValue="active" className="w-full">
      <TabsList className="bg-[var(--color-panel)] border border-[var(--color-border)] p-1">
        <TabsTrigger value="active" className="text-xs data-[state=active]:bg-[var(--color-accent)] data-[state=active]:text-[var(--color-accent-fg)]">待进行</TabsTrigger>
        <TabsTrigger value="done" className="text-xs data-[state=active]:bg-[var(--color-accent)] data-[state=active]:text-[var(--color-accent-fg)]">已结束</TabsTrigger>
      </TabsList>
      <TabsContent value="active" className="mt-4 space-y-3">
        {activeMatches.length > 0 ? activeMatches.map((m) => (
          <MatchCard
            key={m.id}
            matchId={m.id}
            seasonSlug={seasonSlug}
            teamAName={teamMap.get(m.teamAId) ?? unknownTeamName}
            teamBName={teamMap.get(m.teamBId) ?? unknownTeamName}
            scoreA={m.scoreA}
            scoreB={m.scoreB}
            stage={stage}
            format={isMatchFormat(m.format) ? m.format : "bo1"}
            status={isMatchStatus(m.status) ? m.status : "scheduled"}
            scheduledAt={m.scheduledAt}
          />
        )) : (
          <div className="text-center py-8 text-[var(--color-fg-mid)] text-sm">暂无待进行比赛</div>
        )}
      </TabsContent>
      <TabsContent value="done" className="mt-4 space-y-3">
        {doneMatches.length > 0 ? doneMatches.map((m) => (
          <MatchCard
            key={m.id}
            matchId={m.id}
            seasonSlug={seasonSlug}
            teamAName={teamMap.get(m.teamAId) ?? unknownTeamName}
            teamBName={teamMap.get(m.teamBId) ?? unknownTeamName}
            scoreA={m.scoreA}
            scoreB={m.scoreB}
            stage={stage}
            format={isMatchFormat(m.format) ? m.format : "bo1"}
            status={isMatchStatus(m.status) ? m.status : "scheduled"}
            scheduledAt={m.scheduledAt}
            completedAt={m.completedAt}
          />
        )) : (
          <div className="text-center py-8 text-[var(--color-fg-mid)] text-sm">暂无已结束比赛</div>
        )}
      </TabsContent>
    </Tabs>
  );
}
