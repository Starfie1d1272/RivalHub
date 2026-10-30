"use client";
import { readMatchResources } from "@/app/admin/[seasonSlug]/matches/actions";
import { SourceSessions } from "@/components/matches/SourceSessions";
import { MatchDownloads } from "@/components/matches/MatchDownloads";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InlineConfirm } from "@/components/rivalhub";
import { revokeMatchInstallation as telemetry_revokeMatchInstallation } from "@/actions/match-operations";
import { formatCSTDateTime } from "@/lib/utils/date";
import { observeAction } from "@/lib/telemetry/client";

const revokeMatchInstallation = observeAction("match-operations.revokeMatchInstallation", telemetry_revokeMatchInstallation);

type Installation = { id: string; name: string; lastSeenAt: string | null; canRevoke: boolean; owned: boolean; activeMatches: { id: string; label: string }[] };
export function MatchResources({ seasonId }: { seasonId: string }) {
  const [data, setData] = useState<{ installations: Installation[]; downloads: { windows: string; macos: string; windowsZip?: string } | null } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [showSources, setShowSources] = useState(false);
  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === "#match-resources") setOpen(true);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    readMatchResources(seasonId).then(result => {
      if (cancelled) return;
      if (result.success) { setData(result.data); setLoadError(false); }
      else setLoadError(true);
    }).catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [open, seasonId, attempt]);
  const [selected, setSelected] = useState<Installation | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button id="match-resources" variant="outline" size="sm">设备与下载</Button></DialogTrigger>
    <DialogContent size="lg" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>设备与下载</DialogTitle></DialogHeader>
      <DialogBody className="space-y-4">
    {loadError && <p role="alert">无法读取设备与下载。<Button variant="outline" onClick={() => { setLoadError(false); setAttempt(value => value + 1); }}>重试</Button></p>}
    {!data && !loadError && <p role="status">正在读取设备与下载…</p>}
    {data && <><section className="space-y-3"><h3 className="font-medium">Mizar 连接授权</h3>
      <p className="text-sm text-[var(--color-fg-mid)]">在 Mizar 点击「连接 RivalHub」，选择本届赛事。比赛与采集设备在 Mizar 中切换。</p>
      {!data.installations.length && <p className="text-sm">暂无已授权设备</p>}
      {data.installations.map(row => <div key={row.id} className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-3 text-sm"><span>授权人：{row.name}{row.owned ? "（你）" : ""}</span><span>{row.lastSeenAt ? `最近连接：${formatCSTDateTime(new Date(row.lastSeenAt))}` : "等待首次连接"}</span><span>未释放来源：{row.activeMatches.length}</span>{row.canRevoke && <Button size="sm" variant="outline" disabled={pending} onClick={() => { setSelected(row); setReason(""); }}>撤销连接授权</Button>}</div>)}
      {selected && <div className="space-y-3 text-sm"><p>授权人：{selected.name}。本次将关闭该设备的 {selected.activeMatches.length} 个未释放来源。</p>{selected.activeMatches.map(match => <a key={match.id} className="block text-[var(--color-accent)] underline" href={`matches/${match.id}`}>{match.label} · 查看受影响比赛</a>)}<label className="block space-y-1">撤销原因<Input maxLength={500} value={reason} disabled={pending} onChange={event => setReason(event.target.value)} /></label>{pending ? <p role="status">正在撤销…</p> : <InlineConfirm title="确认撤销此设备授权？" sub="设备重新连接本届赛事时，需要再次授权。" danger onCancel={() => setSelected(null)} onConfirm={() => { if (!selected.owned && !reason.trim()) { setError("请填写撤销原因。"); return; } startTransition(async () => { const result = await revokeMatchInstallation(seasonId, selected.id, reason); if (!result.success) setError(result.error.message); else { setSelected(null); setError(null); setAttempt(value => value + 1); router.refresh(); } }); }} />}</div>}
      {error && <p role="alert">{error}</p>}
    </section>
    <Button variant="outline" size="sm" onClick={() => setShowSources(value => !value)}>{showSources ? "收起来源会话" : "查看来源会话"}</Button>
    {showSources && <SourceSessions seasonId={seasonId} />}
    <MatchDownloads downloads={data.downloads} /></> }
      </DialogBody>
    </DialogContent>
  </Dialog>;
}
