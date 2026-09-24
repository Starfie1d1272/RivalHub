import { STATS_METRICS } from "@/lib/stats/metrics";
import { formatDisplayValue } from "@/lib/stats/display";
import type { PlayerAttributeProfile } from "@/lib/stats/player-attributes";

function scoreWidth(score: number | null) {
  return score == null ? "0%" : `${Math.max(0, Math.min(100, score))}%`;
}

export function PlayerAttributes({ profile }: { profile: PlayerAttributeProfile }) {
  return (
    <section className="space-y-3" aria-labelledby="player-attributes-heading">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-dim)]">Player Attributes</p>
          <h3 id="player-attributes-heading" className="mt-1 text-base font-semibold">打法画像</h3>
        </div>
        <p className="text-[11px] text-[var(--color-fg-dim)]">{profile.benchmarkLabel}</p>
      </div>

      <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        {profile.attributes.map((attribute) => (
          <details key={attribute.key} className="group">
            <summary className="grid cursor-pointer list-none grid-cols-[minmax(90px,150px)_minmax(120px,1fr)_auto] items-center gap-4 py-3">
              <div className="min-w-0">
                <div className="font-medium text-[var(--color-fg)]">{attribute.label}</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-fg-dim)]">
                  {attribute.status === "limited"
                    ? "Limited sample"
                    : attribute.status === "qualified" && attribute.rank != null
                      ? `#${attribute.rank} / ${attribute.rankedCount}`
                      : "No data"}
                </div>
              </div>

              <div className="h-1.5 overflow-hidden bg-[var(--color-border)]">
                <div
                  className="h-full bg-[var(--color-accent)] transition-[width]"
                  style={{ width: scoreWidth(attribute.score) }}
                />
              </div>

              <div className="min-w-10 text-right text-lg font-semibold tabular-nums text-[var(--color-fg)]">
                {attribute.score ?? "—"}
              </div>
            </summary>

            <div className="grid gap-3 pb-4 pl-0 sm:grid-cols-2 lg:grid-cols-3">
              {attribute.metrics.map((metric) => {
                const meta = STATS_METRICS[metric.metric];
                return (
                  <div key={metric.key} className="border-t border-[var(--color-border)] pt-2">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--color-fg-mid)]">
                      <span>{meta.label} · {Math.round(metric.weight * 100)}%</span>
                      <span className="tabular-nums">{metric.score ?? "—"}</span>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold tabular-nums">
                        {formatDisplayValue(metric.value, meta)}
                      </span>
                      <span className="text-[10px] text-[var(--color-fg-dim)]">
                        {metric.status === "limited"
                          ? `Limited · min ${metric.floor ?? "—"} ${meta.rankingSampleLabel ?? meta.sampleLabel}`
                          : metric.status === "qualified"
                            ? `${metric.sample ?? "—"} ${meta.rankingSampleLabel ?? meta.sampleLabel}`
                            : "No data"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
