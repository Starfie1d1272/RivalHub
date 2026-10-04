"use client";
import React from "react";
import type { Route } from "next";
import type { SeasonStatus } from "@/types/season";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { presentSeasonStatus } from "@/lib/seasons/presentation";

export interface EventOption { slug: string; name: string; status: string; maps?: string[] }
/** Public-safe summaries only. Search changes the list; confirmation changes the scope. */
export function EventSelector({ events, value, selectedName, allHref, hrefFor }: {
  events: EventOption[]; value: string; selectedName?: string; allHref?: string; hrefFor: (slug: string) => string;
}) {
  const router = useRouter(), id = useId(), list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [search, setSearch] = useState("");
  const options = [...(allHref ? [{ slug: "", name: "全部公开赛事", status: "" }] : []), ...events]
    .filter((e) => `${e.name} ${e.slug}`.toLowerCase().includes(search.trim().toLowerCase()));
  const select = (slug: string) => { setOpen(false); router.push((slug ? hrefFor(slug) : allHref!) as Route); };
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setSearch(""); }}>
    <DialogTrigger asChild><Button variant="outline" className="max-w-full min-w-0 justify-between sm:max-w-72" aria-label="选择赛事"><span className="truncate">{events.find((e) => e.slug === value)?.name ?? selectedName ?? (allHref ? "全部公开赛事" : "选择赛事")}</span><span aria-hidden> ▾</span></Button></DialogTrigger>
    <DialogContent size="sm" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>选择赛事</DialogTitle></DialogHeader>
      <div className="min-h-0 space-y-3 px-4 pb-4 sm:px-6 sm:pb-6">
      <label htmlFor={id} className="text-sm">搜索名称或 slug</label>
      <input id={id} value={search} onChange={(e) => setSearch(e.target.value)} className="w-full border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2" onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const nodes = list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]'); (e.key === "ArrowDown" ? nodes?.[0] : nodes?.[nodes.length - 1])?.focus(); }
      }} />
      <div ref={list} role="listbox" aria-label="公开赛事" className="max-h-72 overflow-y-auto" onKeyDown={(e) => {
        const nodes = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
        const index = nodes.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); nodes[(index + (e.key === "ArrowDown" ? 1 : -1) + nodes.length) % nodes.length]?.focus(); }
        if (e.key === "Home" || e.key === "End") { e.preventDefault(); nodes[e.key === "Home" ? 0 : nodes.length - 1]?.focus(); }
      }}>
        {options.map((e) => <button key={e.slug} role="option" aria-selected={value === e.slug} type="button" onClick={() => select(e.slug)} className="flex w-full min-w-0 items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-3 text-left text-sm hover:bg-[var(--color-panel-hi)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]">
          <span className="min-w-0"><span className="block break-words">{e.name}</span><span className="text-xs text-[var(--color-fg-dim)]">{e.slug}</span></span>
          <span className="shrink-0 text-xs">{value === e.slug ? "✓ " : ""}{e.status ? presentSeasonStatus(e.status as SeasonStatus).label : "历史与当前"}</span>
        </button>)}
        {!options.length && <p role="status" className="p-3 text-sm">试试其它赛事名称</p>}
      </div>
    </div>
    </DialogContent>
  </Dialog>;
}
