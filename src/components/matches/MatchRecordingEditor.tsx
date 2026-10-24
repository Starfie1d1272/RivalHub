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
  const router = useRouter();
  return <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); start(async () => {
    const recordingId = id || crypto.randomUUID(); setId(recordingId);
    const result = await mutateMatchRecording({ matchId, command: { kind: "save", recording: { id: recordingId, commentatorUserId: person.userId, title, url } } });
    if (!result.success) { toast.error(result.error.message); return; }
    toast.success("录像已保存。"); router.refresh();
    if (existing) onCancel?.(); else { setTitle(""); setUrl(""); setId(""); }
  }); }}>
    <label className="min-w-0 flex-1 text-xs">标题<Input required maxLength={100} aria-label={`${person.name}录像标题`} placeholder="图一 / 图二 / 完整录像 / 自定义" value={title} onChange={e => setTitle(e.target.value)} disabled={pending} /></label>
    <label className="min-w-48 flex-[2] text-xs">链接<Input required type="url" maxLength={2000} aria-label={`${person.name}录像链接`} placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} disabled={pending} /></label>
    <Button size="sm" disabled={pending} type="submit">{existing ? "保存修改" : "添加录像"}</Button>
    {onCancel && <Button size="sm" variant="ghost" type="button" disabled={pending} onClick={onCancel}>取消</Button>}
  </form>;
}
export function MatchRecordingEditor({ matchId, recordings, commentators }: { matchId: string; recordings: MatchRecording[]; commentators: { userId: string; name: string }[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (command: { kind: "remove"; id: string } | { kind: "move"; id: string; direction: "up" | "down" }) => start(async () => {
    const result = await mutateMatchRecording({ matchId, command });
    if (!result.success) toast.error(result.error.message); else { setDeleting(null); router.refresh(); }
  });
  // Keep recordings visible after roster corrections, without guessing a new owner.
  const people = [...commentators, ...[...new Set(recordings.map(row => row.commentatorUserId))].filter(id => !commentators.some(p => p.userId === id)).map(userId => ({ userId, name: "原登记解说" }))];
  return <div className="space-y-4">{people.map(person => {
    const rows = recordings.filter(row => row.commentatorUserId === person.userId);
    const current = commentators.some(row => row.userId === person.userId);
    return <section key={person.userId} className="space-y-2 rounded border border-[var(--color-border)] p-3">
      <h3 className="text-sm font-medium">{person.name} · {rows.length} 条回放</h3>
      {rows.map((row, i) => <div key={row.id} className="space-y-2 border-b border-[var(--color-border)] pb-2">
        {editing === row.id ? <RecordingForm matchId={matchId} person={person} existing={row} onCancel={() => setEditing(null)} /> : <div className="flex flex-wrap items-center gap-2">
          <a href={row.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 break-words text-sm text-[var(--color-accent)]">{row.title} ↗</a>
          <Button size="sm" variant="ghost" disabled={pending || i === 0} onClick={() => run({ kind: "move", id: row.id, direction: "up" })} aria-label={`上移 ${row.title}`}>↑</Button>
          <Button size="sm" variant="ghost" disabled={pending || i === rows.length - 1} onClick={() => run({ kind: "move", id: row.id, direction: "down" })} aria-label={`下移 ${row.title}`}>↓</Button>
          {current && <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(row.id)}>编辑</Button>}
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setDeleting(row.id)}>移除</Button>
        </div>}
        {deleting === row.id && <div className="flex items-center gap-2 text-xs"><span>移除这条回放链接？</span><Button size="sm" variant="outline" disabled={pending} onClick={() => run({ kind: "remove", id: row.id })}>确认移除</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => setDeleting(null)}>取消</Button></div>}
      </div>)}
      {current && <RecordingForm matchId={matchId} person={person} />}
    </section>;
  })}</div>;
}
