"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { getPasswordReconciliationState as telemetry_getPasswordReconciliationState, revokeUserSessions as telemetry_revokeUserSessions } from "@/actions/session-management";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { observeAction } from "@/lib/telemetry/client";

const revokeUserSessions = observeAction("session-management.revokeUserSessions", telemetry_revokeUserSessions);
const getPasswordReconciliationState = observeAction("session-management.getPasswordReconciliationState", telemetry_getPasswordReconciliationState);

export function UserSessionControl({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(false);
  const [mutationId, setMutationId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [outcome, setOutcome] = useState<"succeeded" | "rejected">("succeeded");
  const [evidenceSource, setEvidenceSource] = useState<"supabase_auth_audit" | "provider_response_log">("supabase_auth_audit");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [pending, startTransition] = useTransition();
  const generation = useRef(0);
  const validReference = /^[a-zA-Z0-9_.:-]{3,120}$/.test(evidenceReference.trim());
  function changeOpen(next: boolean) {
    const request = ++generation.current;
    setOpen(next);
    setSettled(false);
    setMutationId(null);
    setLoaded(false);
    setEvidenceReference("");
    setOutcome("succeeded");
    setEvidenceSource("supabase_auth_audit");
    if (next) startTransition(async () => {
      const result = await getPasswordReconciliationState(userId);
      if (request !== generation.current) return;
      if (!result.success) { toast.error(result.error.message); return; }
      setMutationId(result.data.mutationId);
      setLoaded(true);
    });
  }
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button size="sm" variant="ghost">退出旧登录</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>退出该用户的所有登录</DialogTitle></DialogHeader>
      <DialogDescription>用户需要重新登录。密码更新异常时，请先核实对应请求已结束及其结果。</DialogDescription>
      {!loaded && <p className="text-sm">{pending ? "读取账号状态…" : "读取失败，请关闭后重试。"}</p>}
      {mutationId && <div className="space-y-3 text-sm">
        <p className="break-all">待核查更新：{mutationId}</p>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={settled} onChange={(event) => setSettled(event.target.checked)} />
          <span>已核实本次请求结束，同时恢复登录</span>
        </label>
        {settled && <>
          <label className="block">已核实结果
            <select className="block w-full" value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}>
              <option value="succeeded">密码更新成功</option><option value="rejected">密码更新被明确拒绝</option>
            </select>
          </label>
          <label className="block">核查来源
            <select className="block w-full" value={evidenceSource} onChange={(event) => setEvidenceSource(event.target.value as typeof evidenceSource)}>
              <option value="supabase_auth_audit">Supabase Auth 审计</option><option value="provider_response_log">服务端 provider 结果日志</option>
            </select>
          </label>
          <label className="block">证据编号
            <input className="block w-full" maxLength={120} value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} placeholder="日志事件或排查编号" />
          </label>
          <p className="text-xs text-[var(--color-fg-dim)]">填写已核实身份、时间和更新结果的记录编号。仅填编号，密码、链接和日志正文请留在原系统。</p>
        </>}
      </div>}
      <Button disabled={pending || !loaded || (settled && !validReference)} onClick={() => {
        const request = generation.current;
        startTransition(async () => {
          const result = await revokeUserSessions({ userId, ...(settled && mutationId ? { reconciliation: { mutationId, outcome, evidenceSource, evidenceReference: evidenceReference.trim(), verified: true } } : {}) });
          if (request !== generation.current) return;
          if (!result.success) { toast.error(result.error.message); return; }
          toast.success(settled ? "已恢复登录，请用户重新登录" : "已退出该用户的所有登录");
          changeOpen(false);
        });
      }}>{pending ? "处理中…" : settled ? "确认恢复登录" : "确认退出所有登录"}</Button>
    </DialogContent>
  </Dialog>;
}
