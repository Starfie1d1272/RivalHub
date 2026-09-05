import React from "react";
import Link from "next/link";
import { Marker, Panel } from "@/components/rivalhub";

const STAGE_TYPE_LABELS: Record<string, string> = {
  round_robin: "循环赛",
  swiss: "Swiss",
  single_elim: "单败淘汰",
  double_elim: "双败淘汰",
};

export function SeasonPrestartCapabilityPanel({
  seasonSlug,
  seasonName,
  hasCaptainVoting,
  hasDraft,
  stagePlan,
}: {
  seasonSlug: string;
  seasonName: string;
  hasCaptainVoting: boolean;
  hasDraft: boolean;
  stagePlan: Array<{ key: string; name: string; type: string }>;
}) {
  const links = [
    hasCaptainVoting ? { label: "队长确认", href: `/admin/${seasonSlug}/captains`, detail: "保留的队长确认入口" } : null,
    hasDraft ? { label: "选秀控制", href: `/admin/${seasonSlug}/draft`, detail: "保留的选秀运营入口" } : null,
  ].filter((link): link is { label: string; href: string; detail: string } => link !== null);

  return (
    <div className="space-y-5">
      <Marker sub="按赛事 capability 提供可用的赛前模块">赛前 · {seasonName}</Marker>
      <Panel label="赛前能力">
        {links.length === 0 ? <p className="text-sm text-[var(--color-fg-mid)]">当前赛事没有额外的已接入赛前运营模块。</p> : <div className="grid gap-3 sm:grid-cols-2">
          {links.map((link) => <Link key={link.href} href={link.href as never} className="border border-[var(--color-border)] p-3 transition-colors hover:bg-[var(--color-panel-hi)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"><span className="font-medium">{link.label} →</span><span className="mt-1 block text-sm text-[var(--color-fg-mid)]">{link.detail}</span></Link>)}
        </div>}
      </Panel>
      <Panel label="阶段计划">
        {stagePlan.length === 0 ? <p className="text-sm text-[var(--color-fg-mid)]">尚未配置可执行的阶段计划。</p> : <ol className="grid gap-2 text-sm sm:grid-cols-2">{stagePlan.map((stage, index) => <li key={stage.key} className="border border-[var(--color-border)] px-3 py-2"><span className="font-mono text-xs text-[var(--color-fg-mid)]">{String(index + 1).padStart(2, "0")}</span> <span className="font-medium">{stage.name}</span><span className="ml-2 text-xs text-[var(--color-fg-mid)]">{STAGE_TYPE_LABELS[stage.type] ?? "赛事阶段"}</span></li>)}</ol>}
      </Panel>
    </div>
  );
}
