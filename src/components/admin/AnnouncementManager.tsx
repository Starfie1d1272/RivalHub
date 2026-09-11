"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createAnnouncement, setAnnouncementStatus, updateAnnouncement } from "@/actions/announcements";
import { ClearFilters, ListToolbar, useListQueryParams } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ANNOUNCEMENT_TYPE_LABELS } from "@/lib/announcements/presentation";
import type { AnnouncementAdminRow } from "@/lib/announcements/read-model";

type SeasonOption = { id: string; name: string };
type Row = AnnouncementAdminRow;
type FormState = { scope: "site" | "season"; seasonId: string | null; type: "notice" | "product_update" | "important_alert"; title: string; body: string; requiresAttention: boolean; attentionUntil: string | null };

const EMPTY: FormState = { scope: "site", seasonId: null, type: "notice", title: "", body: "", requiresAttention: false, attentionUntil: null };
const FILTER_DEFAULTS = { status: "all", scope: "all" } as const;
const SELECT_CLASS_NAME = "h-9 w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]";

export function AnnouncementManager({ rows, seasons, canManageSite }: { rows: Row[]; seasons: SeasonOption[]; canManageSite: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [pending, startTransition] = useTransition();
  const { searchParams, update } = useListQueryParams({ routeBase: "/admin/operations/announcements", defaults: FILTER_DEFAULTS });
  const currentStatus = isAnnouncementStatus(searchParams.get("status")) ? searchParams.get("status")! : "all";
  const currentScope = isAnnouncementScope(searchParams.get("scope")) ? searchParams.get("scope")! : "all";

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY, scope: canManageSite ? "site" : "season", seasonId: canManageSite ? null : seasons[0]?.id ?? null });
    setOpen(true);
  }
  function openEdit(row: Row) {
    setEditing(row);
    setForm({ scope: row.scope, seasonId: row.seasonId, type: row.type, title: row.title, body: row.body, requiresAttention: row.requiresAttention, attentionUntil: row.attentionUntil ? toLocalDateTimeInput(row.attentionUntil) : null });
    setOpen(true);
  }
  function save() {
    startTransition(async () => {
      const result = editing ? await updateAnnouncement(editing.id, toActionForm(form)) : await createAnnouncement(toActionForm(form));
      if (!result.success) { toast.error(result.error.message); return; }
      toast.success(editing ? "公告已更新" : "公告草稿已创建");
      setOpen(false);
      window.location.reload();
    });
  }
  function changeStatus(row: Row, status: "draft" | "published") {
    startTransition(async () => {
      const result = await setAnnouncementStatus(row.id, status);
      if (!result.success) toast.error(result.error.message);
      else { toast.success(status === "published" ? "公告已发布" : "公告已撤回"); window.location.reload(); }
    });
  }
  return (
    <>
      <div className="flex flex-wrap justify-end gap-2"><Button onClick={openCreate}>新建公告</Button></div>
      <ListToolbar aria-label="公告筛选"><label className="min-w-0 w-full sm:w-40"><span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">状态</span><select aria-label="公告状态" value={currentStatus} onChange={(event) => update({ status: event.target.value })} className={SELECT_CLASS_NAME}><option value="all">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option></select></label><label className="min-w-0 w-full sm:w-40"><span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">范围</span><select aria-label="公告范围" value={currentScope} onChange={(event) => update({ scope: event.target.value })} className={SELECT_CLASS_NAME}><option value="all">全部范围</option><option value="site">全站</option><option value="season">赛事</option></select></label><ClearFilters defaults={FILTER_DEFAULTS} searchParams={searchParams} onClear={(updates) => update(updates)} /></ListToolbar>
      <div className="grid gap-3">
        {rows.length === 0 ? <p className="border border-[var(--color-border)] p-5 text-sm text-[var(--color-fg-mid)]">暂无公告。</p> : rows.map((row) => (
          <article key={row.id} className="border border-[var(--color-border)] bg-[var(--color-panel-low)] p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-[var(--color-fg)]">{row.title}</h2>
                  <span className="text-xs text-[var(--color-fg-dim)]">{row.status === "published" ? "已发布" : "草稿"}</span>
                  <span className="text-xs text-[var(--color-fg-dim)]">{ANNOUNCEMENT_TYPE_LABELS[row.type]}</span>
                </div>
                <p className="text-xs text-[var(--color-fg-mid)]">{row.scope === "site" ? "全站" : row.seasonName ?? "赛事"} · {row.updatedAt.toLocaleString("zh-CN")}</p>
                <p className="line-clamp-2 whitespace-pre-wrap text-sm text-[var(--color-fg-mid)]">{row.body}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(row)}>编辑</Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => changeStatus(row, row.status === "published" ? "draft" : "published")}>{row.status === "published" ? "撤回" : "发布"}</Button>
              </div>
            </div>
          </article>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader><DialogTitle>{editing ? "编辑公告" : "新建公告"}</DialogTitle><DialogDescription>正文使用 Markdown；草稿不会出现在公开页面。</DialogDescription></DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="announcement-scope">公告范围</Label><select id="announcement-scope" value={form.scope} disabled={!canManageSite} onChange={(event) => setForm((value) => ({ ...value, scope: event.target.value as "site" | "season", seasonId: event.target.value === "site" ? null : value.seasonId ?? seasons[0]?.id ?? null }))} className="h-10 w-full border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm"><option value="site">全站</option><option value="season">某届赛事</option></select></div>
              <div className="space-y-2"><Label htmlFor="announcement-season">赛事</Label><select id="announcement-season" value={form.seasonId ?? ""} disabled={form.scope === "site"} onChange={(event) => setForm((value) => ({ ...value, seasonId: event.target.value || null }))} className="h-10 w-full border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm"><option value="">请选择赛事</option>{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}</select></div>
            </div>
            <div className="space-y-2"><Label htmlFor="announcement-type">公告类型</Label><select id="announcement-type" value={form.type} onChange={(event) => setForm((value) => ({ ...value, type: event.target.value as typeof value.type }))} className="h-10 w-full border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm">{Object.entries(ANNOUNCEMENT_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="announcement-title">标题</Label><Input id="announcement-title" value={form.title} maxLength={160} onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))} /></div>
            <div className="space-y-2"><Label htmlFor="announcement-body">正文</Label><Textarea id="announcement-body" value={form.body} rows={10} maxLength={20_000} onChange={(event) => setForm((value) => ({ ...value, body: event.target.value }))} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requiresAttention} onChange={(event) => setForm((value) => ({ ...value, requiresAttention: event.target.checked, attentionUntil: event.target.checked ? value.attentionUntil : null }))} />需要主动提醒</label>
            {form.requiresAttention && <div className="space-y-2"><Label htmlFor="announcement-attention-until">提醒截止时间（可选）</Label><Input id="announcement-attention-until" type="datetime-local" value={form.attentionUntil ?? ""} onChange={(event) => setForm((value) => ({ ...value, attentionUntil: event.target.value || null }))} /></div>}
          </DialogBody>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button disabled={pending || !form.title.trim() || !form.body.trim() || (form.scope === "season" && !form.seasonId)} onClick={save}>{pending ? "保存中…" : "保存草稿"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function toActionForm(form: FormState): FormState {
  return { ...form, attentionUntil: form.attentionUntil ? new Date(form.attentionUntil).toISOString() : null };
}

function toLocalDateTimeInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isAnnouncementStatus(value: string | null): value is "draft" | "published" {
  return value === "draft" || value === "published";
}

function isAnnouncementScope(value: string | null): value is "site" | "season" {
  return value === "site" || value === "season";
}
