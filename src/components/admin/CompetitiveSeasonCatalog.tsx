"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteCompetitivePlatformSeason, saveCompetitivePlatformSeason } from "@/actions/competitive-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, StatusBanner } from "@/components/rivalhub";

export type CompetitiveCatalogRow = { id: string; platform: string; seasonKey: string; label: string; rankOrder: string[]; sortOrder: number; active: boolean; isCurrent: boolean };
const blank = (): Omit<CompetitiveCatalogRow, "id"> => ({ platform: "perfect_world", seasonKey: "", label: "", rankOrder: [], sortOrder: 0, active: true, isCurrent: false });

export function CompetitiveSeasonCatalog({ rows }: { rows: CompetitiveCatalogRow[] }) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<CompetitiveCatalogRow | Omit<CompetitiveCatalogRow, "id">>(blank());
  const save = () => startTransition(async () => {
    const result = await saveCompetitivePlatformSeason(draft);
    if (result.success) { toast.success("平台赛季目录已保存"); setDraft(blank()); } else toast.error(result.error.message);
  });
  const remove = (id: string) => startTransition(async () => { const result = await deleteCompetitivePlatformSeason(id); if (result.success) toast.success("平台赛季目录已删除"); else toast.error(result.error.message); });
  const update = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }));
  return <div className="space-y-5"><StatusBanner tone="info" title="平台赛季目录" sub="当前赛季和时间顺序在这里统一维护；参赛者的竞技资料与赛事资格只引用这些目录项。" />
    <Panel label="新增或编辑平台赛季" pad={20}><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>平台</Label><Input value={draft.platform} onChange={(event) => update("platform", event.target.value)} /></div><div className="space-y-1.5"><Label>赛季标识</Label><Input value={draft.seasonKey} onChange={(event) => update("seasonKey", event.target.value)} /></div><div className="space-y-1.5"><Label>显示名称</Label><Input value={draft.label} onChange={(event) => update("label", event.target.value)} /></div><div className="space-y-1.5"><Label>时间顺序</Label><Input type="number" min={0} value={draft.sortOrder} onChange={(event) => update("sortOrder", Number(event.target.value))} /></div><div className="space-y-1.5 sm:col-span-2"><Label>段位顺序</Label><Input value={draft.rankOrder.join(",")} onChange={(event) => update("rankOrder", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} placeholder="由低到高，以逗号分隔" /></div></div><div className="mt-4 flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={draft.active} onChange={(event) => update("active", event.target.checked)} />启用</label><label className="flex items-center gap-2"><input type="checkbox" checked={draft.isCurrent} onChange={(event) => update("isCurrent", event.target.checked)} />当前赛季</label><Button type="button" disabled={pending} onClick={save}>保存目录项</Button>{"id" in draft && <Button type="button" variant="ghost" onClick={() => setDraft(blank())}>取消编辑</Button>}</div></Panel>
    <Panel label="已有目录" pad={0}>{rows.length === 0 ? <p className="p-4 text-sm text-[var(--color-fg-mid)]">尚未建立平台赛季目录。新增当前和上一赛季后，参赛者即可维护竞技档案。</p> : <div className="divide-y divide-[var(--color-border)]">{rows.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">{row.platform} · {row.label}{row.isCurrent ? " · 当前赛季" : ""}</p><p className="font-mono text-xs text-[var(--color-fg-mid)]">{row.seasonKey} · 顺序 {row.sortOrder} · {row.active ? "启用" : "停用"}</p></div><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setDraft(row)}>编辑</Button><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => remove(row.id)}>删除</Button></div></div>)}</div>}</Panel>
  </div>;
}
