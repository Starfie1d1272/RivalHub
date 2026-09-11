"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createAnnouncement, updateAnnouncement } from "@/actions/announcements";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ANNOUNCEMENT_TYPE_LABELS } from "@/lib/announcements/presentation";
import type { AnnouncementAdminRow } from "@/lib/announcements/read-model";

type SeasonOption = { id: string; name: string };

type FormState = {
  scope: "site" | "season";
  seasonId: string | null;
  type: "notice" | "product_update" | "important_alert";
  title: string;
  body: string;
  requiresAttention: boolean;
  attentionUntil: string | null;
};

export function AnnouncementForm({
  initialData,
  announcementId,
  seasons,
  canManageSite,
  isEditing = false,
}: {
  initialData?: AnnouncementAdminRow | null;
  announcementId?: string;
  seasons: SeasonOption[];
  canManageSite: boolean;
  isEditing?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [form, setForm] = useState<FormState>(() => {
    if (initialData) {
      return {
        scope: initialData.scope,
        seasonId: initialData.seasonId,
        type: initialData.type,
        title: initialData.title,
        body: initialData.body,
        requiresAttention: initialData.requiresAttention,
        attentionUntil: initialData.attentionUntil ? toLocalDateTimeInput(initialData.attentionUntil) : null,
      };
    }
    return {
      scope: canManageSite ? "site" : "season",
      seasonId: canManageSite ? null : seasons[0]?.id ?? null,
      type: "notice",
      title: "",
      body: "",
      requiresAttention: false,
      attentionUntil: null,
    };
  });

  function save() {
    startTransition(async () => {
      const payload = {
        ...form,
        attentionUntil: form.attentionUntil ? new Date(form.attentionUntil).toISOString() : null,
      };
      const result = isEditing && announcementId
        ? await updateAnnouncement(announcementId, payload)
        : await createAnnouncement(payload);

      if (!result.success) {
        toast.error(result.error.message);
        return;
      }

      toast.success(isEditing ? "公告已更新" : "公告草稿已创建");
      router.push("/admin/operations/announcements");
      router.refresh();
    });
  }

  const isValid = form.title.trim() && form.body.trim() && (form.scope === "site" || Boolean(form.seasonId));

  return (
    <div className="max-w-3xl space-y-6 rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="announcement-scope">公告范围</Label>
          <select
            id="announcement-scope"
            value={form.scope}
            disabled={!canManageSite || isEditing}
            onChange={(event) =>
              setForm((value) => ({
                ...value,
                scope: event.target.value as "site" | "season",
                seasonId: event.target.value === "site" ? null : value.seasonId ?? seasons[0]?.id ?? null,
              }))
            }
            className="h-10 w-full border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm text-[var(--color-fg)]"
          >
            {canManageSite && <option value="site">全站</option>}
            <option value="season">某届赛事</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="announcement-season">赛事</Label>
          <select
            id="announcement-season"
            value={form.seasonId ?? ""}
            disabled={form.scope === "site" || isEditing}
            onChange={(event) => setForm((value) => ({ ...value, seasonId: event.target.value || null }))}
            className="h-10 w-full border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm text-[var(--color-fg)]"
          >
            <option value="">请选择赛事</option>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="announcement-type">公告类型</Label>
        <select
          id="announcement-type"
          value={form.type}
          onChange={(event) => setForm((value) => ({ ...value, type: event.target.value as typeof value.type }))}
          className="h-10 w-full border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm text-[var(--color-fg)]"
        >
          {Object.entries(ANNOUNCEMENT_TYPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="announcement-title">标题</Label>
        <Input
          id="announcement-title"
          value={form.title}
          maxLength={160}
          placeholder="请输入公告标题"
          onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="announcement-body">正文</Label>
          <span className="text-xs text-[var(--color-fg-dim)]">支持 Markdown 语法</span>
        </div>
        <Textarea
          id="announcement-body"
          value={form.body}
          rows={12}
          maxLength={20_000}
          placeholder="请输入公告正文，支持 Markdown（加粗、列表、链接等）……"
          onChange={(event) => setForm((value) => ({ ...value, body: event.target.value }))}
        />
      </div>

      <div className="space-y-3 rounded-sm border border-[var(--color-border-static)] bg-[var(--color-panel-hi)] p-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[var(--color-fg)]">
          <input
            type="checkbox"
            checked={form.requiresAttention}
            onChange={(event) =>
              setForm((value) => ({
                ...value,
                requiresAttention: event.target.checked,
                attentionUntil: event.target.checked ? value.attentionUntil : null,
              }))
            }
          />
          需要主动提醒（用户进入相关页面时弹窗展示）
        </label>

        {form.requiresAttention && (
          <div className="space-y-2 pt-2">
            <Label htmlFor="announcement-attention-until">提醒截止时间（可选，留空则一直提醒直到手动收回）</Label>
            <Input
              id="announcement-attention-until"
              type="datetime-local"
              value={form.attentionUntil ?? ""}
              onChange={(event) => setForm((value) => ({ ...value, attentionUntil: event.target.value || null }))}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        <Button variant="outline" asChild>
          <Link href="/admin/operations/announcements">取消</Link>
        </Button>
        <Button disabled={pending || !isValid} onClick={save}>
          {pending ? "保存中…" : isEditing ? "保存修改" : "保存草稿"}
        </Button>
      </div>
    </div>
  );
}

function toLocalDateTimeInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
