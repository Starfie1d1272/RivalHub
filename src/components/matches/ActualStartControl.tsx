"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { adoptActualStart, previewActualStart } from "@/actions/actual-start";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Snapshot = { original: string | null; adopted: string | null; revision: number };
type Impact = { stakes: number; requests: number; settlements: number; appeals: number };
export function ActualStartControl({ seasonId, matchId, snapshot }: { seasonId: string; matchId: string; snapshot: Snapshot }) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [impact, setImpact] = useState<Impact | null>(null);
  const [requestId, setRequestId] = useState("");
  const [pending, transition] = useTransition();
  const router = useRouter();
  const toInstant = () => { const date = new Date(`${time}+08:00`); return Number.isNaN(date.getTime()) ? null : date.toISOString(); };
  const current = snapshot.adopted ?? snapshot.original;
  return <details className="space-y-3 rounded border border-[var(--color-border)] p-3">
    <summary className="cursor-pointer text-sm font-medium">实际开局时间 · 低频操作</summary>
    <p className="text-sm">当前采用：{current ? `${new Date(current).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}（北京时间）` : "尚未记录"}</p>
    <Dialog open={open} onOpenChange={value => { if (!pending) { setOpen(value); if (value) { setRequestId(crypto.randomUUID()); setImpact(null); } } }}>
      <DialogTrigger asChild><Button variant="outline">补录或更正</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>补录或更正实际开局时间</DialogTitle><DialogDescription>记录整场比赛首次实际开局，不更改排期或原始开图记录。已关闭的入口不会重新开放。</DialogDescription></DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-1"><Label htmlFor="actual-start-time">实际开局时间（北京时间）</Label><Input id="actual-start-time" type="datetime-local" step="1" disabled={pending} value={time} onChange={e => { setTime(e.target.value); setImpact(null); }} /></div>
          <div className="space-y-1"><Label htmlFor="actual-start-reason">原因</Label><Input id="actual-start-reason" maxLength={500} disabled={pending} value={reason} onChange={e => setReason(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="actual-start-evidence">证据来源</Label><Input id="actual-start-evidence" maxLength={500} disabled={pending} value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="例如比赛录像及时间点" /></div>
          {impact && <p className="text-sm">实际开局后已接受：投入 {impact.stakes} 条、免费预测请求 {impact.requests} 条、BP 申诉 {impact.appeals} 条；本场结算记录 {impact.settlements} 条。请交由既有赛务裁定流程处理，系统不会自动更改账本。</p>}
        </DialogBody>
        <DialogFooter><Button variant="outline" disabled={pending || !time} onClick={() => { const actualAt = toInstant(); if (!actualAt) { toast.error("请填写有效时间。"); return; } transition(async () => { const result = await previewActualStart({ seasonId, matchId, actualAt }); if (result.success) setImpact(result.data); else toast.error(result.error.message); }); }}>查看影响</Button>
          <Button disabled={pending || !impact || !reason.trim() || !evidence.trim()} onClick={() => { const actualAt = toInstant(); if (!actualAt) return; transition(async () => { const result = await adoptActualStart({ seasonId, matchId, actualAt, expectedRevision: snapshot.revision, expectedOriginal: snapshot.original, requestId, reason, evidence }); if (!result.success) toast.error(result.error.message); else { toast.success("实际开局时间已记录"); setOpen(false); router.refresh(); } }); }}>确认记录</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </details>;
}
