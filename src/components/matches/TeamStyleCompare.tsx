import { Panel } from "@/components/rivalhub";
import type { TeamStyleProfile } from "@/actions/team-demo-stats";
import type { HalfSideStats } from "@/lib/demo/halfside-winrate";

interface TeamStyleCompareProps {
  teamAName: string;
  teamBName: string;
  styleA: TeamStyleProfile | null;
  styleB: TeamStyleProfile | null;
  halfSideA: Record<string, HalfSideStats> | null;
  halfSideB: Record<string, HalfSideStats> | null;
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

function pctOrNull(v: number | null | undefined): number | null {
  return v == null ? null : v * 100;
}

function fmt(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}

function StatRow({
  label,
  valA,
  valB,
}: {
  label: string;
  valA: number | null;
  valB: number | null;
}) {
  const winner = compare(valA, valB);
  return (
    <div className="grid grid-cols-3 items-center py-2 border-b border-[var(--color-border)] last:border-0">
      <div
        className="text-right font-mono text-sm font-semibold pr-4"
        style={{ color: numColor("a", winner) }}
      >
        {fmt(valA)}
      </div>
      <div className="text-center text-xs" style={{ color: "var(--color-fg-mid)" }}>
        {label}
      </div>
      <div
        className="text-left font-mono text-sm font-semibold pl-4"
        style={{ color: numColor("b", winner) }}
      >
        {fmt(valB)}
      </div>
    </div>
  );
}

/**
 * 赛前精简版双方风格对比：首杀率 / 残局胜率 / T·CT 半场胜率。
 * 完整画像见各自队伍详情页。
 */
export function TeamStyleCompare({
  teamAName,
  teamBName,
  styleA,
  styleB,
  halfSideA,
  halfSideB,
}: TeamStyleCompareProps) {
  const fkA = pctOrNull(styleA?.firstKillRate);
  const fkB = pctOrNull(styleB?.firstKillRate);
  const clA = pctOrNull(styleA?.clutchWinRate);
  const clB = pctOrNull(styleB?.clutchWinRate);
  const tA = pctOrNull(halfSideA?.t?.winRate);
  const tB = pctOrNull(halfSideB?.t?.winRate);
  const ctA = pctOrNull(halfSideA?.ct?.winRate);
  const ctB = pctOrNull(halfSideB?.ct?.winRate);

  // 全部为空则不渲染
  const allNull = [fkA, fkB, clA, clB, tA, tB, ctA, ctB].every((v) => v == null);
  if (allNull) return null;

  return (
    <Panel label="赛季风格对比">
      <div className="grid grid-cols-3 items-center pb-3 mb-1">
        <div className="text-right text-sm font-bold pr-4 truncate" style={{ color: "var(--color-accent)" }}>
          {teamAName}
        </div>
        <div className="text-center" />
        <div className="text-left text-sm font-bold pl-4 truncate" style={{ color: "var(--color-accent-b)" }}>
          {teamBName}
        </div>
      </div>

      <StatRow label="首杀率" valA={fkA} valB={fkB} />
      <StatRow label="残局胜率" valA={clA} valB={clB} />
      <StatRow label="T 半场胜率" valA={tA} valB={tB} />
      <StatRow label="CT 半场胜率" valA={ctA} valB={ctB} />

      <p className="text-[11px] text-[var(--color-fg-dim)] pt-3 leading-relaxed">
        基于双方赛季 demo 数据，完整画像见各自队伍详情页。
      </p>
    </Panel>
  );
}
