import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import { formatCSTDateTime } from "@/lib/utils/date";
import { MATCH_STAGE_LABELS, MATCH_FORMAT_LABELS } from "@/types/match";

interface H2HMatch {
  matchId: string;
  scheduledAt: Date | null;
  completedAt: Date | null;
  stage: string;
  format: string;
  scoreA: number;
  scoreB: number;
  teamAWon: boolean;
}

interface MatchHeadToHeadProps {
  teamAName: string;
  teamBName: string;
  teamAWins: number;
  teamBWins: number;
  matches: H2HMatch[];
  seasonSlug: string;
}

export function MatchHeadToHead({
  teamAName,
  teamBName,
  teamAWins,
  teamBWins,
  matches,
  seasonSlug,
}: MatchHeadToHeadProps) {
  if (matches.length === 0) return null;

  const displayed = matches.slice(0, 10);

  return (
    <Panel label="历史交锋">
      {/* 汇总标题行 */}
      <div className="flex items-center justify-center gap-3 pb-4 mb-2 border-b border-[var(--color-border)]">
        <span className="font-bold text-sm" style={{ color: "var(--color-accent)" }}>
          {teamAName}
        </span>
        <span className="font-mono font-bold text-base" style={{ color: "var(--color-accent)" }}>
          {teamAWins} 胜
        </span>
        <span className="text-sm" style={{ color: "var(--color-fg-dim)" }}>vs</span>
        <span className="font-mono font-bold text-base" style={{ color: "var(--color-accent-b)" }}>
          {teamBWins} 胜
        </span>
        <span className="font-bold text-sm" style={{ color: "var(--color-accent-b)" }}>
          {teamBName}
        </span>
      </div>

      {/* 比赛列表 */}
      <div className="space-y-1">
        {displayed.map((m) => {
          const displayTime = m.completedAt ?? m.scheduledAt;
          const stageLabel = MATCH_STAGE_LABELS[m.stage] ?? m.stage;
          const formatLabel = MATCH_FORMAT_LABELS[m.format as keyof typeof MATCH_FORMAT_LABELS] ?? m.format.toUpperCase();

          return (
            <div
              key={m.matchId}
              className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center py-2 border-b border-[var(--color-border)] last:border-0 text-sm"
            >
              {/* 日期 */}
              <div style={{ color: "var(--color-fg-dim)", fontSize: 12 }}>
                {displayTime ? formatCSTDateTime(displayTime) : "—"}
              </div>

              {/* 阶段 + 赛制 */}
              <div style={{ color: "var(--color-fg-mid)", fontSize: 12, whiteSpace: "nowrap" }}>
                {stageLabel} · {formatLabel}
              </div>

              {/* 比分链接 */}
              <Link
                href={`/${seasonSlug}/matches/${m.matchId}`}
                className="font-mono font-semibold text-sm hover:underline"
                style={{ color: "var(--color-fg)", whiteSpace: "nowrap" }}
              >
                {m.scoreA} : {m.scoreB}
              </Link>

              {/* 胜负（相对 A 队） */}
              <div
                className="font-mono text-xs font-bold w-4 text-center"
                style={{ color: m.teamAWon ? "var(--color-ok)" : "var(--color-danger)" }}
              >
                {m.teamAWon ? "✓" : "✗"}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
