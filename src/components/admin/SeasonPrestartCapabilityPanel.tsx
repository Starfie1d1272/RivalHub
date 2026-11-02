"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { startFormedSeason } from "@/actions/draft/formation";
import { InlineConfirm, Marker, Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { STAGE_TYPE_LABELS } from "@/lib/seasons/presentation";
import type { StageType } from "@/types/season";

export function SeasonPrestartCapabilityPanel({
  seasonSlug,
  seasonId,
  seasonName,
  hasCaptainVoting,
  hasDraft,
  registrationMode,
  stagePlan,
  canStart,
}: {
  seasonSlug: string;
  seasonId: string;
  seasonName: string;
  hasCaptainVoting: boolean;
  hasDraft: boolean;
  registrationMode: "solo" | "team";
  stagePlan: Array<{ key: string; name: string; type: StageType }>;
  canStart: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const links = [
    registrationMode === "team" ? { label: "队伍报名审核", href: `/admin/${seasonSlug}/registrations`, detail: "处理报名和名单审核" } : null,
    hasCaptainVoting ? { label: "队长确认", href: `/admin/${seasonSlug}/captains`, detail: "处理本届队长确认" } : null,
    hasDraft ? { label: "选秀管理", href: `/admin/${seasonSlug}/draft`, detail: "管理本届选秀流程" } : registrationMode === "solo" ? { label: "管理员编队", href: `/admin/${seasonSlug}/draft`, detail: "创建并编辑编队草稿" } : null,
  ].filter((link): link is { label: string; href: string; detail: string } => link !== null);

  return (
    <div className="space-y-5">
      <Marker sub={`开赛筹备 · ${seasonName}`}>开赛筹备</Marker>
      <Panel label="赛前入口">
        {links.length === 0 ? <p className="text-sm text-[var(--color-fg-mid)]">本届暂无额外赛前操作。</p> : <div className="grid gap-3 sm:grid-cols-2">
          {links.map((link) => <Link key={link.href} href={link.href as never} className="border border-[var(--color-border)] p-3 transition-colors hover:bg-[var(--color-panel-hi)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"><span className="font-medium">{link.label} →</span><span className="mt-1 block text-sm text-[var(--color-fg-mid)]">{link.detail}</span></Link>)}
        </div>}
      </Panel>
      {canStart && <Panel label="赛事开赛">
        <p className="mb-3 text-sm">处理全部报名和名单审核后，可采用名单并开赛，随后前往赛程管理生成赛程。</p>
        <Button type="button" disabled={pending} onClick={() => setConfirming(true)}>采用名单并开赛</Button>
        {confirming && <InlineConfirm title="确认采用名单并开赛？" sub="将检查并冻结已批准名单，然后进入比赛阶段。" confirmLabel="确认开赛" onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); startTransition(async () => { const result = await startFormedSeason({ seasonId }); if (!result.success) { toast.error(result.error.message); return; } toast.success("名单已冻结，赛事已开始；可前往赛程管理生成赛程。"); router.refresh(); }); }} />}
      </Panel>}
      <Panel label="阶段计划">
        {stagePlan.length === 0 ? <p className="text-sm text-[var(--color-fg-mid)]">尚未配置可执行的阶段计划。</p> : <ol className="grid gap-2 text-sm sm:grid-cols-2">{stagePlan.map((stage, index) => <li key={stage.key} className="border border-[var(--color-border)] px-3 py-2"><span className="font-mono text-xs text-[var(--color-fg-mid)]">{String(index + 1).padStart(2, "0")}</span> <span className="font-medium">{stage.name}</span><span className="ml-2 text-xs text-[var(--color-fg-mid)]">{STAGE_TYPE_LABELS[stage.type] ?? "赛事阶段"}</span></li>)}</ol>}
      </Panel>
    </div>
  );
}
