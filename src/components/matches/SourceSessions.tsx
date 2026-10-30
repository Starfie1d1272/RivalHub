"use client";
import { useEffect, useState, useTransition } from "react";
import { readSourceSessions } from "@/app/admin/[seasonSlug]/matches/actions";
import { closeCompletedSources } from "@/actions/match-operations";
import type { listSourceSessions } from "@/lib/mizar/source-management";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineConfirm } from "@/components/rivalhub";
import { formatCSTDateTime } from "@/lib/utils/date";

type Page = Awaited<ReturnType<typeof listSourceSessions>>;
const time = (value: string | null) => value ? formatCSTDateTime(new Date(value)) : "无";
export function SourceSessions({ seasonId }: { seasonId: string }) {
  const [page, setPage] = useState<Page | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let cancelled = false;
    readSourceSessions(seasonId, cursor).then(result => {
      if (cancelled) return;
      if (result.success) { setPage(result.data); setSelected([]); }
      else setMessage(result.error.message);
    }).catch(() => { if (!cancelled) setMessage("无法读取来源会话。"); });
    return () => { cancelled = true; };
  }, [seasonId, cursor, revision]);
  const rows = page?.rows ?? [];
  const candidates = rows.filter(row => selected.includes(row.sessionId));
  return <section className="space-y-3 border-t border-[var(--color-border)] pt-4 text-sm">
    <h3 className="font-medium">来源会话</h3>
    <p>未释放来源不代表正在直播或上报。当前接收状态未知；回执时间是服务器确认时间。关闭已完赛来源会拒绝迟到的旧事件，无法证明设备没有离线队列。</p>
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setRevision(value => value + 1)}>刷新</Button><Button size="sm" variant="outline" disabled={!page} onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(page, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "source-sessions.json"; link.click(); URL.revokeObjectURL(url); }}>导出本页 JSON</Button></div>
    {!page && <p>正在读取来源会话…</p>}
    {page && !rows.length && <p>没有来源会话。</p>}
    {rows.map(row => <article key={row.sessionId} className="space-y-1 border-t border-[var(--color-border)] pt-2">
      <p><a className="text-[var(--color-accent)] underline" href={`matches/${row.identity.matchId}`}>{row.entryA ?? "队伍 A"} vs {row.entryB ?? "队伍 B"}</a> · {row.matchStatus === "finished" && !row.closedAt ? "已完赛，来源未释放" : row.closedAt ? "已关闭" : "未释放来源"} · 比赛状态 {row.matchStatus}</p>
      <p>授权人：{row.ownerName} · 打开 {time(row.openedAt)} · 关闭 {time(row.closedAt)} {row.closeReason ?? ""} · 完赛 {time(row.completedAt)} · 比赛更新 {time(row.matchUpdatedAt)}</p>
      <p>会话 {row.sessionId} · 设备 {row.identity.installationId} · producer {row.identity.producerInstanceId} · live {row.identity.liveSessionId} · authority {row.identity.authorityRevision}</p>
      <p>context {row.contextRevision} · generation {row.generation} · epoch {row.epoch} · 序号 {row.lastReliableSeq} · 来源可靠时间 {time(row.lastReliableEventAt)} · 健康 {Object.values(row.health).join(" / ")}</p>
      <p>回执 {row.receiptCount} · 最近 {row.latestReceipt ? `${time(row.latestReceipt.acceptedAt)} ${row.latestReceipt.kind} / ${row.latestReceipt.outcome}` : "无"}</p>
      {row.blockedReason && <p>暂不可关闭：{row.blockedReason}</p>}
      {!row.closedAt && row.canClose && !row.blockedReason && <label><input type="checkbox" checked={selected.includes(row.sessionId)} disabled={pending || (!selected.includes(row.sessionId) && selected.length >= 20)} onChange={event => setSelected(current => event.target.checked ? [...current, row.sessionId] : current.filter(id => id !== row.sessionId))} /> 选择关闭</label>}
    </article>)}
    {page && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={!history.length} onClick={() => { setCursor(history.at(-1)); setHistory(history.slice(0, -1)); }}>上一页</Button><Button size="sm" variant="outline" disabled={!page.nextCursor} onClick={() => { setHistory([...history, cursor]); setCursor(page.nextCursor!); }}>下一页</Button></div>}
    {candidates.length > 0 && <div className="space-y-2"><label className="block">关闭原因（关闭他人设备时必填）<Input maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label><Button size="sm" disabled={pending} onClick={() => setConfirming(true)}>关闭所选 {candidates.length} 条</Button>{confirming && <InlineConfirm title="确认关闭这些已完赛来源？" sub="每条会重新核对，变化或不符合条件的会跳过。" danger onCancel={() => setConfirming(false)} onConfirm={() => {
      if (candidates.some(row => !row.owned) && !reason.trim()) { setMessage("请填写关闭他人设备来源的原因。"); return; }
      startTransition(async () => { const result = await closeCompletedSources(seasonId, candidates.map(row => ({ sessionId: row.sessionId, identity: row.identity, expectedVersion: row.expectedVersion, reason }))); setConfirming(false); if (!result.success) setMessage(result.error.message); else { const labels = { closed: "已关闭", already_closed: "此前已关闭", changed: "状态已变化，请刷新核对", blocked: "暂不可关闭", failed: "操作失败，请核对" }; setMessage(result.data.map(item => `${item.sessionId}: ${labels[item.status]}${"reason" in item ? ` (${item.reason})` : ""}`).join("；")); setRevision(value => value + 1); } });
    }} />}</div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
