import { Panel } from "@/components/rivalhub";

interface TeamStat {
  wins: number;
  losses: number;
  avgRating: number | null;
  avgAdr: number | null;
  avgKd: number | null;
}

interface TeamStatsCompareProps {
  teamAName: string;
  teamBName: string;
  statA: TeamStat;
  statB: TeamStat;
}

type Comparison = "a" | "b" | "equal";

function compare(a: number | null, b: number | null): Comparison {
  if (a == null || b == null) return "equal";
  if (a > b) return "a";
  if (b > a) return "b";
  return "equal";
}

function numColor(side: "a" | "b", winner: Comparison): string {
  if (winner === "equal") return "var(--color-fg)";
  if (side === "a" && winner === "a") return "var(--color-accent)";
  if (side === "b" && winner === "b") return "var(--color-accent-b)";
  return "var(--color-fg)";
}

interface StatRowProps {
  label: string;
  valA: string;
  valB: string;
  winner: Comparison;
}

function StatRow({ label, valA, valB, winner }: StatRowProps) {
  return (
    <div className="grid grid-cols-3 items-center py-2 border-b border-[var(--color-border)] last:border-0">
      <div
        className="text-right font-mono text-sm font-semibold pr-4"
        style={{ color: numColor("a", winner) }}
      >
        {valA}
      </div>
      <div
        className="text-center text-xs"
        style={{ color: "var(--color-fg-mid)" }}
      >
        {label}
      </div>
      <div
        className="text-left font-mono text-sm font-semibold pl-4"
        style={{ color: numColor("b", winner) }}
      >
        {valB}
      </div>
    </div>
  );
}

export function TeamStatsCompare({
  teamAName,
  teamBName,
  statA,
  statB,
}: TeamStatsCompareProps) {
  const totalA = statA.wins + statA.losses;
  const totalB = statB.wins + statB.losses;
  const wrA = totalA > 0 ? (statA.wins / totalA) * 100 : 0;
  const wrB = totalB > 0 ? (statB.wins / totalB) * 100 : 0;

  const recordWinner: Comparison = (() => {
    if (wrA > wrB) return "a";
    if (wrB > wrA) return "b";
    return "equal";
  })();

  return (
    <Panel label="赛季对比">
      {/* 队名行 */}
      <div className="grid grid-cols-3 items-center pb-3 mb-1">
        <div
          className="text-right text-sm font-bold pr-4 truncate"
          style={{ color: "var(--color-accent)" }}
        >
          {teamAName}
        </div>
        <div className="text-center" />
        <div
          className="text-left text-sm font-bold pl-4 truncate"
          style={{ color: "var(--color-accent-b)" }}
        >
          {teamBName}
        </div>
      </div>

      <StatRow
        label="赛季战绩"
        valA={`${statA.wins}-${statA.losses}`}
        valB={`${statB.wins}-${statB.losses}`}
        winner={recordWinner}
      />
      <StatRow
        label="胜率"
        valA={`${wrA.toFixed(1)}%`}
        valB={`${wrB.toFixed(1)}%`}
        winner={compare(wrA, wrB)}
      />
      <StatRow
        label="Rating"
        valA={statA.avgRating != null ? statA.avgRating.toFixed(2) : "—"}
        valB={statB.avgRating != null ? statB.avgRating.toFixed(2) : "—"}
        winner={compare(statA.avgRating, statB.avgRating)}
      />
      <StatRow
        label="ADR"
        valA={statA.avgAdr != null ? statA.avgAdr.toFixed(1) : "—"}
        valB={statB.avgAdr != null ? statB.avgAdr.toFixed(1) : "—"}
        winner={compare(statA.avgAdr, statB.avgAdr)}
      />
      <StatRow
        label="K/D"
        valA={statA.avgKd != null ? statA.avgKd.toFixed(2) : "—"}
        valB={statB.avgKd != null ? statB.avgKd.toFixed(2) : "—"}
        winner={compare(statA.avgKd, statB.avgKd)}
      />
    </Panel>
  );
}
