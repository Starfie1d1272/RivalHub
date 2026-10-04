import React from "react";
import type { OperatorLineupDifference, OperatorLineupPlayer } from "@/lib/admin/matches/types";
import type { ReviewReason } from "@/lib/admin/matches/source-state";
import { REVIEW_REASON_LABEL } from "@/lib/admin/matches/source-state";
import { mapLabel } from "@/lib/maps";
import { formatCSTDateTime } from "@/lib/utils/date";

const steps: Record<ReviewReason, string> = {
  identity_mismatch: "在 Mizar 选择下方对阵，并确认游戏已进入本场 Perfect 房间。正确的本图开始数据通过核验后，自动记录恢复。",
  lineup_mismatch: "先检查 Perfect 房间和当前采集对象，再按差异核对玩家。实际换人请通过首发管理登记，并按赛事规则处理。",
  execution_mismatch: "检查 Perfect 房间地图，并在 Mizar 选择本场比赛。重新选择正确比赛或采集来源，系统收到本图开始数据并核验通过后恢复自动记录。",
  result_conflict: "对照 Perfect 最终比分。本站记录正确时保留该结果；需要更正时，打开下方对应地图的「更正比分」。",
  source_conflict: "在 Mizar 选择负责发送本场数据的设备，完成数据源切换后重新核验。",
  continuity_failure: "检查 Mizar 当前采集的比赛与地图。正确的本图开始数据到达后重新核验；需要手动收尾时，在备用录分中确认当前地图。",
};

function SteamPlayers({ players }: { players: OperatorLineupPlayer[] }) {
  return players.map((player, index) => <span key={player.steam64 ?? index}>{index > 0 && "、"}{player.profileUrl
    ? <a href={player.profileUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] underline">{player.name}</a>
    : player.name}</span>);
}
export function OperatorIssuePanel({ reasons, review }: { reasons: ReviewReason[]; review: {
  expectedTeams: string; currentMap: string | null; officialScore: string | null;
  evidence: { at: string; mapBinding: string; mapName: string | null; scoreA: number | null; scoreB: number | null; lineupDifference?: OperatorLineupDifference | null } | null;
} }) {
  if (!reasons.length) return null;
  const difference = review.evidence?.lineupDifference;
  return <section aria-label="异常核对步骤" className="space-y-4 rounded border border-[var(--color-warn)] p-4 text-sm">
    <dl className="grid gap-3 sm:grid-cols-2">
      <div><dt className="text-[var(--color-fg-mid)]">本场比赛</dt><dd className="mt-1 font-medium">{review.expectedTeams}</dd><dd>{review.currentMap ?? "待确认当前地图"}{review.officialScore && ` · 正式比分 ${review.officialScore}`}</dd></div>
      {review.evidence && <div><dt className="text-[var(--color-fg-mid)]">收到的数据 · {formatCSTDateTime(new Date(review.evidence.at))}</dt><dd className="mt-1">{review.evidence.mapName ? mapLabel(review.evidence.mapName) : "地图待确认"}{review.evidence.scoreA !== null && review.evidence.scoreB !== null && ` · ${review.evidence.scoreA}:${review.evidence.scoreB}`}</dd><dd>{review.evidence.mapBinding}</dd></div>}
    </dl>
    {reasons.map(reason => <div key={reason}><h3 className="font-semibold">{REVIEW_REASON_LABEL[reason]}</h3><p className="mt-1 leading-6 text-[var(--color-fg-mid)]">{steps[reason]}</p></div>)}
    {difference && <div className="space-y-2">
      {difference.missing.length > 0 && <p>待核对首发：<SteamPlayers players={difference.missing} /></p>}
      {difference.unexpected.length > 0 && <p>采集到的额外玩家：<SteamPlayers players={difference.unexpected} /></p>}
      {difference.duplicated.length > 0 && <p>重复玩家：<SteamPlayers players={difference.duplicated} /></p>}
    </div>}
    {reasons.includes("lineup_mismatch") && <a className="text-[var(--color-accent)] underline" href="#match-lineups">查看本场首发</a>}
  </section>;
}
