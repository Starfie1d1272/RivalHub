"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { setAnnouncementStatus } from "@/actions/announcements";
import { ClearFilters, ListToolbar, useListQueryParams } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { ANNOUNCEMENT_TYPE_LABELS, toAnnouncementExcerpt } from "@/lib/announcements/presentation";
import type { AnnouncementAdminRow } from "@/lib/announcements/read-model";

type SeasonOption = { id: string; name: string };
type Row = AnnouncementAdminRow;

const FILTER_DEFAULTS = { status: "all", scope: "all" } as const;
const SELECT_CLASS_NAME = "h-9 w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]";

export function AnnouncementManager({ rows }: { rows: Row[]; seasons: SeasonOption[]; canManageSite: boolean }) {
  const [pending, startTransition] = useTransition();
  const { searchParams, update } = useListQueryParams({ routeBase: "/admin/operations/announcements", defaults: FILTER_DEFAULTS });
  const currentStatus = isAnnouncementStatus(searchParams.get("status")) ? searchParams.get("status")! : "all";
  const currentScope = isAnnouncementScope(searchParams.get("scope")) ? searchParams.get("scope")! : "all";

  function changeStatus(row: Row, status: "draft" | "published") {
    startTransition(async () => {
      const result = await setAnnouncementStatus(row.id, status);
      if (!result.success) toast.error(result.error.message);
      else {
        toast.success(status === "published" ? "公告已发布" : "公告已撤回");
        window.location.reload();
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild>
          <Link href="/admin/operations/announcements/new">新建公告</Link>
        </Button>
      </div>

      <ListToolbar aria-label="公告筛选">
        <label className="min-w-0 w-full sm:w-40">
          <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">状态</span>
          <select aria-label="公告状态" value={currentStatus} onChange={(event) => update({ status: event.target.value })} className={SELECT_CLASS_NAME}>
            <option value="all">全部状态</option>
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
          </select>
        </label>
        <label className="min-w-0 w-full sm:w-40">
          <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">范围</span>
          <select aria-label="公告范围" value={currentScope} onChange={(event) => update({ scope: event.target.value })} className={SELECT_CLASS_NAME}>
            <option value="all">全部范围</option>
            <option value="site">全站</option>
            <option value="season">赛事</option>
          </select>
        </label>
        <ClearFilters defaults={FILTER_DEFAULTS} searchParams={searchParams} onClear={(updates) => update(updates)} />
      </ListToolbar>

      <div className="grid gap-3">
        {rows.length === 0 ? (
          <p className="border border-[var(--color-border)] p-5 text-sm text-[var(--color-fg-mid)]">暂无公告。</p>
        ) : (
          rows.map((row) => (
            <article key={row.id} className="border border-[var(--color-border)] bg-[var(--color-panel-low)] p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-[var(--color-fg)]">{row.title}</h2>
                    <span className="text-xs text-[var(--color-fg-dim)]">{row.status === "published" ? "已发布" : "草稿"}</span>
                    <span className="text-xs text-[var(--color-fg-dim)]">{ANNOUNCEMENT_TYPE_LABELS[row.type]}</span>
                    {row.requiresAttention && (
                      <span className="rounded-sm bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-xs text-[var(--color-accent)]">主动提醒</span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--color-fg-mid)]">
                    {row.scope === "site" ? "全站" : row.seasonName ?? "赛事"} · {row.updatedAt.toLocaleString("zh-CN")}
                  </p>
                  <p className="line-clamp-2 whitespace-pre-wrap text-sm text-[var(--color-fg-mid)]">{toAnnouncementExcerpt(row.body)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/admin/operations/announcements/${row.id}`}>编辑</Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => changeStatus(row, row.status === "published" ? "draft" : "published")}
                  >
                    {row.status === "published" ? "撤回" : "发布"}
                  </Button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </>
  );
}

function isAnnouncementStatus(value: string | null): value is "draft" | "published" {
  return value === "draft" || value === "published";
}

function isAnnouncementScope(value: string | null): value is "site" | "season" {
  return value === "site" || value === "season";
}
