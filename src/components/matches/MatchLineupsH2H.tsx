"use client";

import { useState } from "react";
import Link from "next/link";

interface PlayerStats {
  userId: string | null;
  perfectName: string;
  maps: number;
  avgRating: number;
  avgAdr: number;
  kdRatio: number | null;
  avgHs: number;
  avgFk: number;
  avgWe: number;
}

interface MatchLineupsH2HProps {
  teamAName: string;
  teamBName: string;
  teamAPlayers: PlayerStats[];
  teamBPlayers: PlayerStats[];
}

const A_COLOR = "var(--color-accent)";
const B_COLOR = "var(--color-accent-b)";

function CompareBar({
  aVal,
  bVal,
}: {
  aVal: number;
  bVal: number;
}) {
  const total = aVal + bVal;
  const aPct = total > 0 ? (aVal / total) * 100 : 50;
  return (
    <div className="flex h-1.5 rounded overflow-hidden w-full">
      <div style={{ width: `${aPct}%`, background: A_COLOR }} />
      <div style={{ width: `${100 - aPct}%`, background: B_COLOR }} />
    </div>
  );
}

interface StatRowProps {
  label: string;
  aVal: number;
  bVal: number;
  format?: (v: number) => string;
  showBar?: boolean;
}

function StatRow({ label, aVal, bVal, format, showBar = true }: StatRowProps) {
  const fmt = format ?? ((v: number) => v.toString());
  const aWins = aVal >= bVal;

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-20 text-[11px] text-[var(--color-fg-dim)] shrink-0">
        {label}
      </span>
      <span
        className="w-16 text-right text-xs tabular-nums shrink-0 font-medium"
        style={{ color: aWins ? A_COLOR : "var(--color-fg-mid)" }}
      >
        {fmt(aVal)}
      </span>
      {showBar ? (
        <div className="flex-1 min-w-0">
          <CompareBar aVal={aVal} bVal={bVal} />
        </div>
      ) : (
        <div className="flex-1" />
      )}
      <span
        className="w-16 text-left text-xs tabular-nums shrink-0 font-medium"
        style={{ color: !aWins ? B_COLOR : "var(--color-fg-mid)" }}
      >
        {fmt(bVal)}
      </span>
    </div>
  );
}

function PlayerButton({
  player,
  selected,
  side,
  onClick,
}: {
  player: PlayerStats;
  selected: boolean;
  side: "a" | "b";
  onClick: () => void;
}) {
  const color = side === "a" ? A_COLOR : B_COLOR;
  return (
    <button
      onClick={onClick}
      className="px-2 py-1 text-xs rounded transition-all"
      style={{
        background: selected ? `${color}22` : "var(--color-panel-hi)",
        color: selected ? color : "var(--color-fg-mid)",
        border: `1px solid ${selected ? color : "var(--color-border)"}`,
        outline: selected ? `1px solid ${color}` : "none",
        outlineOffset: "1px",
      }}
    >
      {player.perfectName}
    </button>
  );
}

export function MatchLineupsH2H({
  teamAName,
  teamBName,
  teamAPlayers,
  teamBPlayers,
}: MatchLineupsH2HProps) {
  const [aIdx, setAIdx] = useState(0);
  const [bIdx, setBIdx] = useState(0);

  const pa = teamAPlayers[aIdx];
  const pb = teamBPlayers[bIdx];

  if (!pa || !pb) {
    return (
      <p className="text-xs text-[var(--color-fg-dim)] py-2">暂无阵容数据</p>
    );
  }

  const kdA = pa.kdRatio ?? 0;
  const kdB = pb.kdRatio ?? 0;

  return (
    <div
      className="rounded-md overflow-hidden"
      style={{ border: "1px solid var(--color-border)" }}
    >
      {/* Team A player selector */}
      <div
        className="flex flex-wrap gap-1.5 px-3 py-2"
        style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-panel-hi)" }}
      >
        <span className="text-[10px] text-[var(--color-fg-dim)] self-center mr-1 shrink-0">
          {teamAName}
        </span>
        {teamAPlayers.map((p, i) => (
          <PlayerButton
            key={p.perfectName}
            player={p}
            selected={i === aIdx}
            side="a"
            onClick={() => setAIdx(i)}
          />
        ))}
      </div>

      {/* H2H content */}
      <div className="px-3 py-3">
        {/* Player names header */}
        <div className="flex items-center gap-2 mb-3">
          <div className="w-20 shrink-0" />
          <div className="w-16 text-right shrink-0">
            {pa.userId ? (
              <Link
                href={`/players/${pa.userId}`}
                className="text-sm font-semibold hover:opacity-80 transition-opacity truncate block"
                style={{ color: A_COLOR }}
              >
                {pa.perfectName}
              </Link>
            ) : (
              <span className="text-sm font-semibold truncate block" style={{ color: A_COLOR }}>
                {pa.perfectName}
              </span>
            )}
          </div>
          <div className="flex-1 text-center text-xs text-[var(--color-fg-dim)] shrink-0">vs</div>
          <div className="w-16 text-left shrink-0">
            {pb.userId ? (
              <Link
                href={`/players/${pb.userId}`}
                className="text-sm font-semibold hover:opacity-80 transition-opacity truncate block"
                style={{ color: B_COLOR }}
              >
                {pb.perfectName}
              </Link>
            ) : (
              <span className="text-sm font-semibold truncate block" style={{ color: B_COLOR }}>
                {pb.perfectName}
              </span>
            )}
          </div>
        </div>

        {/* Maps row — no bar */}
        <div className="flex items-center gap-2 py-1">
          <span className="w-20 text-[11px] text-[var(--color-fg-dim)] shrink-0">图数</span>
          <span className="w-16 text-right text-xs tabular-nums shrink-0 text-[var(--color-fg-mid)]">
            {pa.maps}
          </span>
          <div className="flex-1 text-center text-[10px] text-[var(--color-fg-dim)]">—</div>
          <span className="w-16 text-left text-xs tabular-nums shrink-0 text-[var(--color-fg-mid)]">
            {pb.maps}
          </span>
        </div>

        <StatRow
          label="Rating"
          aVal={pa.avgRating}
          bVal={pb.avgRating}
          format={(v) => v.toFixed(2)}
        />
        <StatRow
          label="ADR"
          aVal={pa.avgAdr}
          bVal={pb.avgAdr}
          format={(v) => v.toFixed(1)}
        />
        <StatRow
          label="K/D"
          aVal={kdA}
          bVal={kdB}
          format={(v) => v.toFixed(2)}
        />
        <StatRow
          label="HS%"
          aVal={pa.avgHs}
          bVal={pb.avgHs}
          format={(v) => `${v.toFixed(0)}%`}
        />
        <StatRow
          label="首杀/图"
          aVal={pa.avgFk}
          bVal={pb.avgFk}
          format={(v) => v.toFixed(1)}
        />
        <StatRow
          label="WE"
          aVal={pa.avgWe}
          bVal={pb.avgWe}
          format={(v) => v.toFixed(1)}
        />
      </div>

      {/* Team B player selector */}
      <div
        className="flex flex-wrap gap-1.5 px-3 py-2"
        style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-panel-hi)" }}
      >
        <span className="text-[10px] text-[var(--color-fg-dim)] self-center mr-1 shrink-0">
          {teamBName}
        </span>
        {teamBPlayers.map((p, i) => (
          <PlayerButton
            key={p.perfectName}
            player={p}
            selected={i === bIdx}
            side="b"
            onClick={() => setBIdx(i)}
          />
        ))}
      </div>
    </div>
  );
}
