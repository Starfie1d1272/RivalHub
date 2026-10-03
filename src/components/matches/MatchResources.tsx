"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { InlineConfirm } from "@/components/rivalhub";
import { revokeMatchInstallation } from "@/actions/match-operations";
import { formatCSTDateTime } from "@/lib/utils/date";

export function MatchResources({ seasonId, data }: { seasonId: string; data: { installations: { id: string; name: string; lastSeenAt: string | null }[]; downloads: { windows: string; macos: string } | null } }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <details id="match-resources" className="rounded border border-[var(--color-border)] p-4 space-y-3">
    <summary className="cursor-pointer font-semibold">赛事运营资源 · Mizar 连接与赛后工具</summary>
    <p className="text-sm text-[var(--color-fg-mid)]">在 Mizar 中点击「连接 RivalHub」，通过网站授权选择本届赛事。切换比赛数据源与制作操作继续在 Mizar 中完成。</p>
    {!data.installations.length && <p className="text-sm">暂无 Mizar 连接，仍可正常人工赛务。</p>}
    {data.installations.map(row => <div key={row.id} className="flex flex-wrap items-center gap-3 text-sm"><span>{row.name}</span><span>{row.lastSeenAt ? `最近连接：${formatCSTDateTime(new Date(row.lastSeenAt))}` : "尚无连接记录"}</span><Button size="sm" variant="outline" disabled={pending} onClick={() => setSelected(row.id)}>撤销连接授权</Button></div>)}
    {selected && !pending && <InlineConfirm title="撤销此 Mizar 连接？" sub="该连接将停止向本届赛事提供数据，正式赛果不变。" danger onCancel={() => setSelected(null)} onConfirm={() => startTransition(async () => { const result = await revokeMatchInstallation(seasonId, selected); if (!result.success) setError(result.error.message); else { setSelected(null); router.refresh(); } })} />}
    {error && <p role="alert">{error}</p>}
    <p className="text-sm">去 Perfect 下载 Demo，在本地 Uploader 解析后同步分析结果。</p>
    <div className="flex flex-wrap gap-4 text-sm text-[var(--color-accent)]">{data.downloads ? <><a href={data.downloads.windows}>下载 Windows Uploader</a><a href={data.downloads.macos}>下载 macOS Uploader</a></> : <a href="https://github.com/Starfie1d1272/cs2-demo-analysis-kit/releases/latest">获取 Demo Uploader ↗</a>}</div>
  </details>;
}
