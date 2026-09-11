"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setFeedbackStatus } from "@/actions/feedback";
import { ClearFilters, ListToolbar, useListQueryParams } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FEEDBACK_CATEGORY_LABELS, FEEDBACK_STATUS_LABELS, type FeedbackCategory, type FeedbackStatus } from "@/lib/feedback/validation";
import type { FeedbackAdminRow } from "@/lib/feedback/read-model";

const FILTER_DEFAULTS = { status: "all", category: "all" } as const;
const SELECT_CLASS_NAME = "h-9 w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]";

export function FeedbackManager({ rows }: { rows: FeedbackAdminRow[] }) {
  const { searchParams, update: updateQuery } = useListQueryParams({ routeBase: "/admin/operations/feedback", defaults: FILTER_DEFAULTS });
  const [selected, setSelected] = useState<FeedbackAdminRow | null>(null);
  const [pending, startTransition] = useTransition();
  const currentStatus = isFeedbackStatus(searchParams.get("status")) ? searchParams.get("status")! : "all";
  const currentCategory = isFeedbackCategory(searchParams.get("category")) ? searchParams.get("category")! : "all";
  function update(status: "new" | "triaged" | "resolved") { if (!selected) return; startTransition(async () => { const result = await setFeedbackStatus({ id: selected.id, status }); if (!result.success) toast.error(result.error.message); else { toast.success("反馈状态已更新"); setSelected(null); window.location.reload(); } }); }
  return <><ListToolbar aria-label="用户反馈筛选"><label className="min-w-0 w-full sm:w-40"><span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">状态</span><select aria-label="反馈状态" value={currentStatus} onChange={(event) => updateQuery({ status: event.target.value })} className={SELECT_CLASS_NAME}><option value="all">全部状态</option>{Object.entries(FEEDBACK_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="min-w-0 w-full sm:w-48"><span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">类型</span><select aria-label="反馈类型" value={currentCategory} onChange={(event) => updateQuery({ category: event.target.value })} className={SELECT_CLASS_NAME}><option value="all">全部类型</option>{Object.entries(FEEDBACK_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><ClearFilters defaults={FILTER_DEFAULTS} searchParams={searchParams} onClear={(updates) => updateQuery(updates)} /></ListToolbar><div className="overflow-x-auto border border-[var(--color-border)]"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[var(--color-panel-low)] text-xs text-[var(--color-fg-dim)]"><tr><th className="px-3 py-3">类型</th><th className="px-3 py-3">内容</th><th className="px-3 py-3">页面</th><th className="px-3 py-3">赛事</th><th className="px-3 py-3">用户</th><th className="px-3 py-3">版本</th><th className="px-3 py-3">状态</th><th className="px-3 py-3">提交时间</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-[var(--color-border)] align-top hover:bg-[var(--color-panel-low)]"><td className="px-3 py-3">{row.categoryLabel}</td><td className="max-w-[260px] px-3 py-3"><button type="button" className="line-clamp-2 text-left text-[var(--color-fg)] hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]" onClick={() => setSelected(row)}>{row.body}</button></td><td className="px-3 py-3 font-mono text-xs text-[var(--color-fg-dim)]">{row.pathname}</td><td className="px-3 py-3">{row.seasonName ?? "—"}</td><td className="px-3 py-3">{row.userLabel ?? "匿名"}</td><td className="px-3 py-3 font-mono text-xs">{row.releaseVersion}</td><td className="px-3 py-3">{row.statusLabel}</td><td className="whitespace-nowrap px-3 py-3 text-xs text-[var(--color-fg-dim)]">{new Date(row.createdAt).toLocaleString("zh-CN")}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="p-5 text-sm text-[var(--color-fg-mid)]">暂无反馈。</p>}</div><Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent size="md"><DialogHeader><DialogTitle>{selected?.categoryLabel ?? "用户反馈"}</DialogTitle><DialogDescription>反馈详情与安全上下文；不包含完整 URL、Cookie 或运行时日志。</DialogDescription></DialogHeader><DialogBody className="space-y-4"><p className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--color-fg-primary)]">{selected?.body}</p><dl className="grid gap-2 text-sm text-[var(--color-fg-secondary)]"><div><dt className="inline font-medium">页面：</dt> <dd className="inline font-mono text-xs">{selected?.pathname}</dd></div><div><dt className="inline font-medium">赛事：</dt> <dd className="inline">{selected?.seasonName ?? "无"}</dd></div><div><dt className="inline font-medium">用户：</dt> <dd className="inline">{selected?.userLabel ?? "匿名"}</dd></div><div><dt className="inline font-medium">版本：</dt> <dd className="inline font-mono text-xs">{selected?.releaseVersion}</dd></div></dl></DialogBody><DialogFooter><Button variant="outline" disabled={pending} onClick={() => update("new")}>待处理</Button><Button variant="outline" disabled={pending} onClick={() => update("triaged")}>处理中</Button><Button disabled={pending} onClick={() => update("resolved")}>已处理</Button></DialogFooter></DialogContent></Dialog></>;
}

function isFeedbackStatus(value: string | null): value is FeedbackStatus {
  return value !== null && value in FEEDBACK_STATUS_LABELS;
}

function isFeedbackCategory(value: string | null): value is FeedbackCategory {
  return value !== null && value in FEEDBACK_CATEGORY_LABELS;
}
