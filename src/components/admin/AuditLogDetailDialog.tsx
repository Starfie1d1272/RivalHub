"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { fetchAuditLogDetail } from "@/actions/audit";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { AuditLogDetail, AuditLogView } from "@/lib/audit/presentation";
import { formatCST } from "@/lib/utils/date";

export function AuditLogDetailDialog({ log, seasonScopeId }: { log: AuditLogView; seasonScopeId?: string }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<AuditLogDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const requestVersion = useRef(0);

  function load() {
    const version = ++requestVersion.current;
    setError(null);
    setDetail(null);
    startTransition(async () => {
      try {
        const result = await fetchAuditLogDetail({ id: log.id, ...(seasonScopeId ? { seasonScopeId } : {}) });
        if (version !== requestVersion.current) return;
        if (result.success) setDetail(result.data);
        else setError(result.error.message);
      } catch {
        if (version === requestVersion.current) setError("日志详情加载失败，请重试。");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next) load();
      else { requestVersion.current += 1; setDetail(null); setError(null); }
    }}>
      <DialogTrigger asChild>
        <button type="button" aria-label={`查看${log.actionLabel}详情`} className="rounded-sm text-left underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--color-border-focus)]">
          {log.actionLabel}
        </button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>操作详情</DialogTitle>
          <DialogDescription>{log.actionLabel} · {formatCST(log.createdAt)}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 text-sm">
          {pending && <p role="status">正在加载详情…</p>}
          {error && <div role="alert" className="space-y-2 text-[var(--color-danger)]"><p>{error}</p><button type="button" className="underline" onClick={load} disabled={pending}>重试</button></div>}
          {detail && <>
            {detail.description && <p>{detail.description}</p>}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3">
              <dt className="text-[var(--color-fg-dim)]">赛事范围</dt><dd className="break-words">{detail.seasonLabel}</dd>
              <dt className="text-[var(--color-fg-dim)]">执行者</dt><dd className="break-words">{detail.actorLabel}</dd>
              {detail.authorizedByLabel && <><dt className="text-[var(--color-fg-dim)]">设备授权人</dt><dd className="break-words">{detail.authorizedByLabel}<span className="block text-xs text-[var(--color-fg-dim)]">授权身份不代表本次设备操作人</span></dd></>}
              <dt className="text-[var(--color-fg-dim)]">目标</dt><dd className="break-words">{detail.targetTypeLabel} · {detail.targetLabel}{detail.targetContext && <span className="block text-xs text-[var(--color-fg-dim)]">{detail.targetContext}</span>}</dd>
              {detail.summary && <><dt className="text-[var(--color-fg-dim)]">摘要</dt><dd className="break-words">{detail.summary}</dd></>}
              {detail.fields.map(field => <DetailField key={field.label} label={field.label} value={field.value} />)}
            </dl>
            {detail.fields.length === 0 && <p className="text-xs text-[var(--color-fg-dim)]">此记录没有额外的可展示变更详情。</p>}
          </>}
        </DialogBody>
        <DialogFooter>{detail?.targetHref && <Link href={detail.targetHref as Route} className="text-sm underline underline-offset-4">打开比赛工作台</Link>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return <><dt className="text-[var(--color-fg-dim)]">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></>;
}
