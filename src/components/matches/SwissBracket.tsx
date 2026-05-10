import Link from "next/link";
import type {
  SwissViewData,
  SwissRoundColumn,
  SwissRecordGroup,
  SwissMatchRow,
  SwissTeamSlot,
} from "@/lib/swiss/data";

interface SwissBracketProps {
  data: SwissViewData;
  seasonSlug: string;
}

export function SwissBracket({ data, seasonSlug }: SwissBracketProps) {
  if (data.rounds.length === 0) {
    return (
      <div className="py-16 text-center text-[var(--text-secondary)] text-sm">
        瑞士轮赛程尚未生成
      </div>
    );
  }

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <div className="flex gap-4 min-w-[800px] pb-4">
        {data.rounds.map((round) => (
          <SwissColumn
            key={round.round}
            round={round}
            seasonSlug={seasonSlug}
          />
        ))}
        {/* 晋级/淘汰汇总列 */}
        {data.rounds.length > 0 && (
          <AdvancementColumn
            teams={data.teams}
            advanceCount={data.advanceCount}
          />
        )}
      </div>
    </div>
  );
}

function SwissColumn({
  round,
  seasonSlug,
}: {
  round: SwissRoundColumn;
  seasonSlug: string;
}) {
  const statusColor = {
    finished: "opacity-70",
    active: "",
    upcoming: "opacity-40",
  };

  return (
    <div className={`flex-1 min-w-[160px] max-w-[200px] ${statusColor[round.status]}`}>
      {/* 轮次标题 */}
      <div className="text-center mb-2">
        <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          {round.status === "upcoming" && round.groups.length === 0
            ? `R${round.round}`
            : `第 ${round.round} 轮`}
        </span>
        {round.status === "active" && (
          <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
        )}
      </div>

      {/* 战绩分组 */}
      <div className="space-y-3">
        {round.groups.map((group) => (
          <SwissMatchupGroup
            key={group.record}
            group={group}
            round={round}
            seasonSlug={seasonSlug}
          />
        ))}
        {round.status === "upcoming" && round.groups.length === 0 && (
          <div className="py-8 text-center text-[var(--text-muted)] text-xs">
            —
          </div>
        )}
      </div>
    </div>
  );
}

function SwissMatchupGroup({
  group,
  round,
  seasonSlug,
}: {
  group: SwissRecordGroup;
  round: SwissRoundColumn;
  seasonSlug: string;
}) {
  return (
    <div>
      {/* 战绩标签 */}
      <div
        className={`text-xs font-medium mb-1.5 px-1.5 py-0.5 rounded text-center ${
          isEliminatedRecord(group.record)
            ? "bg-red-500/10 text-red-400"
            : isAdvancedRecord(group.record)
              ? "bg-emerald-500/10 text-emerald-400"
              : "bg-[var(--bg-overlay)] text-[var(--text-secondary)]"
        }`}
      >
        {group.record}
      </div>

      {/* 对阵列表 */}
      <div className="space-y-1.5">
        {group.matchups.map((match) => (
          <SwissMatchupRow
            key={match.matchId}
            match={match}
            seasonSlug={seasonSlug}
          />
        ))}
      </div>
    </div>
  );
}

function SwissMatchupRow({
  match,
  seasonSlug,
}: {
  match: SwissMatchRow;
  seasonSlug: string;
}) {
  const winA = (match.scoreA ?? 0) > (match.scoreB ?? 0);
  const winB = (match.scoreB ?? 0) > (match.scoreA ?? 0);
  const isFinished = match.status === "finished";

  return (
    <Link
      href={`/${seasonSlug}/matches/${match.matchId}`}
      className="block rounded border border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)] transition-colors p-2"
    >
      {/* Team A */}
      <div className="flex items-center justify-between gap-1 text-xs">
        <span
          className={`truncate flex-1 ${
            isFinished
              ? winA
                ? "text-[var(--text-primary)] font-medium"
                : "text-[var(--text-muted)]"
              : "text-[var(--text-primary)]"
          }`}
        >
          {match.teamAName}
        </span>
        {isFinished && (
          <span
            className={`tabular shrink-0 ${
              winA
                ? "text-emerald-400 font-semibold"
                : "text-[var(--text-muted)]"
            }`}
          >
            {match.scoreA}
          </span>
        )}
      </div>

      {/* Team B */}
      <div className="flex items-center justify-between gap-1 text-xs mt-0.5">
        <span
          className={`truncate flex-1 ${
            isFinished
              ? winB
                ? "text-[var(--text-primary)] font-medium"
                : "text-[var(--text-muted)]"
              : "text-[var(--text-primary)]"
          }`}
        >
          {match.teamBName}
        </span>
        {isFinished && (
          <span
            className={`tabular shrink-0 ${
              winB
                ? "text-emerald-400 font-semibold"
                : "text-[var(--text-muted)]"
            }`}
          >
            {match.scoreB}
          </span>
        )}
      </div>

      {/* 状态标签 */}
      {!isFinished && (
        <div className="mt-1 text-[10px] text-[var(--text-muted)]">
          {match.status === "in_progress" ? (
            <span className="text-amber-400">进行中</span>
          ) : match.status === "cancelled" ? (
            <span className="text-red-400">已取消</span>
          ) : (
            <span className="text-[var(--text-muted)]">{match.format.toUpperCase()}</span>
          )}
        </div>
      )}
    </Link>
  );
}

function AdvancementColumn({
  teams,
  advanceCount,
}: {
  teams: SwissTeamSlot[];
  advanceCount: number;
}) {
  const advanced = teams
    .filter((t) => t.status === "advanced")
    .sort((a, b) => a.seed - b.seed);
  const eliminated = teams
    .filter((t) => t.status === "eliminated")
    .sort((a, b) => a.seed - b.seed);

  return (
    <div className="flex-1 min-w-[140px] max-w-[180px] space-y-4">
      {/* 晋级 */}
      {advanced.length > 0 && (
        <div>
          <div className="text-xs font-medium mb-1.5 px-1.5 py-0.5 rounded text-center bg-emerald-500/10 text-emerald-400">
            晋级 ({advanced.length}/{advanceCount})
          </div>
          <div className="space-y-1">
            {advanced.map((t) => (
              <div
                key={t.teamId}
                className="flex items-center justify-between text-xs px-2 py-1 rounded bg-[var(--bg-elevated)] border border-[var(--border)]"
              >
                <span className="text-[var(--text-primary)] truncate">
                  {t.teamName}
                </span>
                <span className="text-[var(--text-muted)] ml-1 tabular">
                  {t.wins}:{t.losses}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 淘汰 */}
      {eliminated.length > 0 && (
        <div>
          <div className="text-xs font-medium mb-1.5 px-1.5 py-0.5 rounded text-center bg-red-500/10 text-red-400">
            淘汰 ({eliminated.length})
          </div>
          <div className="space-y-1">
            {eliminated.map((t) => (
              <div
                key={t.teamId}
                className="flex items-center justify-between text-xs px-2 py-1 rounded bg-[var(--bg-elevated)] border border-[var(--border)] opacity-60"
              >
                <span className="text-[var(--text-muted)] truncate">
                  {t.teamName}
                </span>
                <span className="text-[var(--text-muted)] ml-1 tabular">
                  {t.wins}:{t.losses}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 未定 */}
      {advanced.length === 0 && eliminated.length === 0 && (
        <div className="py-8 text-center text-[var(--text-muted)] text-xs">
          —
        </div>
      )}
    </div>
  );
}

function isAdvancedRecord(record: string): boolean {
  return record === "3:0" || record === "3:1" || record === "3:2";
}

function isEliminatedRecord(record: string): boolean {
  return record === "0:3" || record === "1:3" || record === "2:3";
}
