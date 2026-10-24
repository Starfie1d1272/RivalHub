"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { observeAction } from "@/lib/telemetry/client";
import { mutateMatchRecording as recordingAction } from "@/actions/postmatch";
import type { MatchRecording } from "@/lib/postmatch/recording-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const mutateMatchRecording = observeAction("postmatch.mutateMatchRecording", recordingAction);

function RecordingForm({ matchId, person, existing, onCancel }: { matchId: string; person: { userId: string; name: string }; existing?: MatchRecording; onCancel?: () => void }) {
  const [id, setId] = useState(existing?.id ?? "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [pending, start] = useTransition();
  const [guidance, setGuidance] = useState<string | null>(null);
  const router = useRouter();
  return <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); start(async () => {
    if (guidance) return;
    let committed = false;
    try {
    const recordingId = id || crypto.randomUUID(); setId(recordingId);
    const result = await mutateMatchRecording({ matchId, command: { kind: "save", recording: { id: recordingId, commentatorUserId: person.userId, title, url } } });
    if (!result.success) { if (result.error.code === "INTERNAL_ERROR") setGuidance("录像保存结果待核对，请刷新页面查看，不要重复保存。"); toast.error(result.error.message); return; }
    committed = true;
    if (result.data?.refreshPending) setGuidance("录像已保存，刷新待完成。请刷新页面核对。");
    toast.success("录像已保存。"); router.refresh();
    if (existing) onCancel?.(); else { setTitle(""); setUrl(""); setId(""); }
    } catch { setGuidance(committed ? "录像已保存，页面刷新未完成。" : "录像保存结果待核对，草稿已保留。请刷新页面查看，不要重复保存。"); }
  }); }}>
    <label className="min-w-0 flex-1 text-xs">标题<Input required maxLength={100} aria-label={`${person.name}录像标题`} placeholder="图一 / 图二 / 完整录像 / 自定义" value={title} onChange={e => setTitle(e.target.value)} disabled={pending || Boolean(guidance)} /></label>
    <label className="min-w-48 flex-[2] text-xs">链接<Input required type="url" maxLength={2000} aria-label={`${person.name}录像链接`} placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} disabled={pending || Boolean(guidance)} /></label>
    <Button size="sm" disabled={pending || Boolean(guidance)} type="submit">{existing ? "保存修改" : "添加录像"}</Button>
    {onCancel && <Button size="sm" variant="ghost" type="button" disabled={pending || Boolean(guidance)} onClick={onCancel}>取消</Button>}
    {guidance && <p role="alert" className="basis-full text-sm text-[var(--color-danger)]">{guidance}</p>}
  </form>;
}
export function MatchRecordingEditor({ matchId, recordings, commentators }: { matchId: string; recordings: MatchRecording[]; commentators: { userId: string; name: string }[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [guidance, setGuidance] = useState<string | null>(null);
  const router = useRouter();
  const run = (command: { kind: "remove"; id: string } | { kind: "move"; id: string; direction: "up" | "down" }) => start(async () => {
    if (guidance) return;
    let committed = false;
    try {
      const result = await mutateMatchRecording({ matchId, command });
      if (!result.success) {
        if (result.error.code === "INTERNAL_ERROR") setGuidance("录像操作结果待核对，请刷新页面查看当前顺序，不要重复操作。");
        toast.error(result.error.message);
        return;
      }
      committed = true;
      if (result.data?.refreshPending) setGuidance("录像操作已提交，刷新待完成。请刷新页面核对。");
      setDeleting(null);
      router.refresh();
    } catch { setGuidance(committed ? "录像操作已提交，页面刷新未完成。" : "录像操作结果待核对，请刷新页面查看当前顺序，不要重复操作。"); }
  });
  // Keep recordings visible after roster corrections, without guessing a new owner.
  const people = [...commentators, ...[...new Set(recordings.map(row => row.commentatorUserId))].filter(id => !commentators.some(p => p.userId === id)).map(userId => ({ userId, name: "原登记解说" }))];
  return <div className="space-y-4">{guidance && <p role="alert" className="text-sm text-[var(--color-danger)]">{guidance}</p>}{people.map(person => {
    const rows = recordings.filter(row => row.commentatorUserId === person.userId);
    const current = commentators.some(row => row.userId === person.userId);
    return <section key={person.userId} className="space-y-2 rounded border border-[var(--color-border)] p-3">
      <h3 className="text-sm font-medium">{person.name} · {rows.length} 条回放</h3>
      {rows.map((row, i) => <div key={row.id} className="space-y-2 border-b border-[var(--color-border)] pb-2">
        {editing === row.id ? <RecordingForm matchId={matchId} person={person} existing={row} onCancel={() => setEditing(null)} /> : <div className="flex flex-wrap items-center gap-2">
          <a href={row.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 break-words text-sm text-[var(--color-accent)]">{row.title} ↗</a>
          <Button size="sm" variant="ghost" disabled={pending || Boolean(guidance) || i === 0} onClick={() => run({ kind: "move", id: row.id, direction: "up" })} aria-label={`上移 ${row.title}`}>↑</Button>
          <Button size="sm" variant="ghost" disabled={pending || Boolean(guidance) || i === rows.length - 1} onClick={() => run({ kind: "move", id: row.id, direction: "down" })} aria-label={`下移 ${row.title}`}>↓</Button>
          {current && <Button size="sm" variant="ghost" disabled={pending || Boolean(guidance)} onClick={() => setEditing(row.id)}>编辑</Button>}
          <Button size="sm" variant="ghost" disabled={pending || Boolean(guidance)} onClick={() => setDeleting(row.id)}>移除</Button>
        </div>}
        {deleting === row.id && <div className="flex items-center gap-2 text-xs"><span>移除这条回放链接？</span><Button size="sm" variant="outline" disabled={pending || Boolean(guidance)} onClick={() => run({ kind: "remove", id: row.id })}>确认移除</Button><Button size="sm" variant="ghost" disabled={pending || Boolean(guidance)} onClick={() => setDeleting(null)}>取消</Button></div>}
      </div>)}
      {current && <RecordingForm matchId={matchId} person={person} />}
    </section>;
  })}</div>;
}
