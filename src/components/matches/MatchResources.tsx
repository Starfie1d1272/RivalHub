"use client";
import { MatchDownloads } from "@/components/matches/MatchDownloads";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineConfirm } from "@/components/rivalhub";
import { revokeMatchInstallation } from "@/actions/match-operations";
import { formatCSTDateTime } from "@/lib/utils/date";

type Installation = { id: string; name: string; lastSeenAt: string | null; canRevoke: boolean; owned: boolean; activeMatches: { id: string; label: string }[] };
export function MatchResources({ seasonId, data }: { seasonId: string; data: { installations: Installation[]; downloads: { windows: string; macos: string; windowsZip?: string } | null } }) {
  const [selected, setSelected] = useState<Installation | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <details id="match-resources" className="rounded border border-[var(--color-border)] p-4 space-y-4">
    <summary className="cursor-pointer font-semibold">设备与下载</summary>
    <section className="space-y-3"><h3 className="font-medium">Mizar 连接授权</h3>
      <p className="text-sm text-[var(--color-fg-mid)]">在 Mizar 点击「连接 RivalHub」，选择本届赛事。比赛与采集设备在 Mizar 中切换。</p>
      {!data.installations.length && <p className="text-sm">暂无已授权设备</p>}
      {data.installations.map(row => <div key={row.id} className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-3 text-sm"><span>授权人：{row.name}{row.owned ? "（你）" : ""}</span><span>{row.lastSeenAt ? `最近连接：${formatCSTDateTime(new Date(row.lastSeenAt))}` : "等待首次连接"}</span><span>活动连接：{row.activeMatches.length}</span>{row.canRevoke && <Button size="sm" variant="outline" disabled={pending} onClick={() => { setSelected(row); setReason(""); }}>撤销连接授权</Button>}</div>)}
      {selected && <div className="space-y-3 text-sm"><p>授权人：{selected.name}。本次将关闭该设备的 {selected.activeMatches.length} 个活动连接。</p>{selected.activeMatches.map(match => <a key={match.id} className="block text-[var(--color-accent)] underline" href={`matches/${match.id}`}>{match.label} · 查看受影响比赛</a>)}<label className="block space-y-1">撤销原因<Input maxLength={500} value={reason} disabled={pending} onChange={event => setReason(event.target.value)} /></label>{pending ? <p role="status">正在撤销…</p> : <InlineConfirm title="确认撤销此设备授权？" sub="设备重新连接本届赛事时，需要再次授权。" danger onCancel={() => setSelected(null)} onConfirm={() => { if (!selected.owned && !reason.trim()) { setError("请填写撤销原因。"); return; } startTransition(async () => { const result = await revokeMatchInstallation(seasonId, selected.id, reason); if (!result.success) setError(result.error.message); else { setSelected(null); setError(null); router.refresh(); } }); }} />}</div>}
      {error && <p role="alert">{error}</p>}
    </section>
    <MatchDownloads downloads={data.downloads} />
  </details>;
}
