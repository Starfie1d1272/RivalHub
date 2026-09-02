"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createCompetitivePlatformRank,
  createCompetitivePlatformSeason,
  deleteCompetitivePlatformRank,
  deleteCompetitivePlatformSeason,
  moveCompetitivePlatformRank,
  moveCompetitivePlatformSeason,
  setCurrentCompetitivePlatformSeason,
  setCompetitivePlatformSeasonActive,
  updateCompetitivePlatform,
  updateCompetitivePlatformRankLabel,
  updateCompetitivePlatformSeason,
} from "@/actions/competitive-platform";
import { resolveCatalogSeasonRoles, type CompetitivePlatformCatalogEntry } from "@/lib/competitive/catalog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InlineConfirm, Panel, StatusBanner } from "@/components/rivalhub";

type Platform = CompetitivePlatformCatalogEntry;

type Run = (work: () => Promise<{ success: boolean; error?: { message: string } }>, okMessage: string) => void;

function suggestedSeasonKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, "-");
}

function useCatalogActions() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run: Run = (work, okMessage) => startTransition(async () => {
    const result = await work();
    if (result.success) { toast.success(okMessage); router.refresh(); }
    else toast.error(result.error?.message ?? "操作失败，请稍后重试。");
  });
  return { pending, run };
}

function SeasonStatusChips({ season, platform }: { season: Platform["seasons"][number]; platform: Platform }) {
  const { current, previous } = resolveCatalogSeasonRoles(platform);
  return (
    <span className="flex flex-wrap gap-1.5 text-[11px]">
      {current?.id === season.id && <span className="rounded-sm px-1.5 py-0.5 font-semibold" style={{ background: "color-mix(in srgb, var(--color-accent) 14%, transparent)", color: "var(--color-accent)" }}>当前赛季</span>}
      {previous?.id === season.id && <span className="rounded-sm px-1.5 py-0.5 font-medium" style={{ background: "var(--color-panel)", color: "var(--color-fg-mid)" }}>上一赛季</span>}
      {current?.id !== season.id && previous?.id !== season.id && <span className="rounded-sm px-1.5 py-0.5 font-medium" style={{ background: "var(--color-panel)", color: "var(--color-fg-mid)" }}>历史赛季</span>}
      <span className="rounded-sm px-1.5 py-0.5" style={{ background: "var(--color-panel)", color: season.active ? "var(--color-fg-mid)" : "var(--color-danger)" }}>{season.active ? "启用" : "停用"}</span>
    </span>
  );
}

export function CompetitivePlatformCatalog({ platforms }: { platforms: Platform[] }) {
  const { pending, run } = useCatalogActions();
  const [newSeason, setNewSeason] = useState<{ platform: string; seasonKey: string; label: string; insertSeasonId: string; insertPosition: "before" | "after" } | null>(null);
  const [seasonLabelDraft, setSeasonLabelDraft] = useState<{ id: string; label: string } | null>(null);
  const [newRank, setNewRank] = useState<{ platform: string; label: string; rankKey: string } | null>(null);
  const [rankLabelDraft, setRankLabelDraft] = useState<{ id: string; label: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ kind: "set-current" | "delete-season" | "delete-rank"; id: string; title: string; sub?: string } | null>(null);

  return (
    <div className="space-y-5">
      {platforms.length === 0 && <StatusBanner tone="warn" title="内置竞技平台目录未就绪" sub="2.0 内置 Perfect World 与 5E；若目录没有出现，请检查 active migration，而不是在后台临时创建新平台。" />}

      {platforms.map((platform) => {
        const ranks = [...platform.ranks].sort((a, b) => a.sortOrder - b.sortOrder);
        const seasons = [...platform.seasons].sort((a, b) => b.sortOrder - a.sortOrder);
        return (
          <Panel key={platform.key} label={platform.displayName} pad={0}>
            <div className="space-y-5 p-5">
              {/* Platform identity */}
              <div className="flex flex-wrap items-end justify-between gap-3">
                <PlatformIdentityRow key_={platform.key} displayName={platform.displayName} ratingLabel={platform.ratingLabel} pending={pending} onSave={(displayName) => run(() => updateCompetitivePlatform({ key: platform.key, displayName }), "平台目录已更新")} />
              </div>

              {/* Seasons */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">赛季</h3>
                  <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setNewSeason({ platform: platform.key, seasonKey: "", label: "", insertSeasonId: "append", insertPosition: "before" })}>+ 新增赛季</Button>
                </div>
                {newSeason?.platform === platform.key && (
                  <div className="grid gap-3 rounded-sm border border-[var(--color-border)] p-4 sm:grid-cols-2">
                    <div className="space-y-1.5"><Label>显示名称</Label><Input value={newSeason.label} onChange={(event) => setNewSeason({ ...newSeason, label: event.target.value, seasonKey: newSeason.seasonKey || suggestedSeasonKey(event.target.value) })} placeholder="例如 2026S2" /></div>
                    <div className="space-y-1.5"><Label>稳定标识（创建后不可修改）</Label><Input value={newSeason.seasonKey} onChange={(event) => setNewSeason({ ...newSeason, seasonKey: event.target.value })} placeholder={suggestedSeasonKey(newSeason.label) || "例如 2026s2"} className="font-mono" /><p className="text-xs text-[var(--color-fg-mid)]">默认由显示名称规范化生成；请在创建前核对，后续不会变更。</p></div>
                    <div className="space-y-1.5"><Label>插入位置</Label><Select value={newSeason.insertSeasonId} onValueChange={(insertSeasonId) => setNewSeason({ ...newSeason, insertSeasonId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="append">作为最新赛季</SelectItem>{seasons.map((season) => <SelectItem key={season.id} value={season.id}>{season.label}</SelectItem>)}</SelectContent></Select></div>
                    {newSeason.insertSeasonId !== "append" && <div className="space-y-1.5"><Label>相对位置</Label><Select value={newSeason.insertPosition} onValueChange={(position: "before" | "after") => setNewSeason({ ...newSeason, insertPosition: position })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="before">插入到该赛季之前</SelectItem><SelectItem value="after">插入到该赛季之后</SelectItem></SelectContent></Select></div>}
                    <div className="flex items-end gap-2">
                      <Button type="button" size="sm" disabled={pending || !(newSeason.seasonKey || suggestedSeasonKey(newSeason.label)).trim() || !newSeason.label.trim()} onClick={() => run(() => createCompetitivePlatformSeason({ platform: newSeason.platform, seasonKey: newSeason.seasonKey || suggestedSeasonKey(newSeason.label), label: newSeason.label, insertAt: newSeason.insertSeasonId === "append" ? undefined : { seasonId: newSeason.insertSeasonId, position: newSeason.insertPosition } }), "赛季已新增")}>创建</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setNewSeason(null)}>取消</Button>
                    </div>
                  </div>
                )}
                {seasons.length === 0 && <p className="text-sm text-[var(--color-fg-mid)]">该平台还没有赛季目录。新增当前赛季与上一赛季后，参赛者才能维护竞技档案、赛事才能冻结资格上下文。</p>}
                <div className="divide-y divide-[var(--color-border)] rounded-sm border border-[var(--color-border)]">
                  {seasons.map((season, index) => (
                    <div key={season.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 space-y-1">
                        {seasonLabelDraft?.id === season.id ? (
                          <div className="flex items-center gap-2">
                            <Input value={seasonLabelDraft.label} onChange={(event) => setSeasonLabelDraft({ ...seasonLabelDraft, label: event.target.value })} className="max-w-56" />
                            <Button type="button" size="sm" disabled={pending || !seasonLabelDraft.label.trim()} onClick={() => run(() => updateCompetitivePlatformSeason(seasonLabelDraft), "赛季显示名称已更新")}>保存</Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setSeasonLabelDraft(null)}>取消</Button>
                          </div>
                        ) : (
                          <p className="font-medium">{season.label} <span className="ml-1 font-mono text-xs text-[var(--color-fg-dim)]">{season.seasonKey}</span></p>
                        )}
                        <SeasonStatusChips season={season} platform={platform} />
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-sm">
                        <Button type="button" size="sm" variant="ghost" disabled={pending || index === 0} onClick={() => run(() => moveCompetitivePlatformSeason({ id: season.id, direction: "later" }), "时间顺序已更新")} title="视觉上移（更晚赛季）">↑</Button>
                        <Button type="button" size="sm" variant="ghost" disabled={pending || index === seasons.length - 1} onClick={() => run(() => moveCompetitivePlatformSeason({ id: season.id, direction: "earlier" }), "时间顺序已更新")} title="视觉下移（更早赛季）">↓</Button>
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setSeasonLabelDraft({ id: season.id, label: season.label })}>编辑</Button>
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => setCompetitivePlatformSeasonActive({ id: season.id, active: !season.active }), season.active ? "赛季已停用" : "赛季已启用")}>{season.active ? "停用" : "启用"}</Button>
                        {!season.isCurrent && <Button type="button" size="sm" variant="outline" disabled={pending || !season.active} onClick={() => setConfirmAction({ kind: "set-current", id: season.id, title: `设为当前赛季`, sub: `当前赛季将从 ${seasons.find((item) => item.isCurrent)?.label ?? "（无）"} 切换为 ${season.label}；原当前赛季将成为历史/上一赛季。` })}>设为当前赛季</Button>}
                        <Button type="button" size="sm" variant="ghost" className="text-[var(--color-danger)]" disabled={pending} onClick={() => setConfirmAction({ kind: "delete-season", id: season.id, title: `删除赛季 ${season.label}？`, sub: "只有未被竞技资料和已发布赛事引用的赛季可以删除。" })}>删除</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Rank ladder */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">段位顺序 · 由低到高</h3>
                  <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setNewRank({ platform: platform.key, label: "", rankKey: "" })}>+ 添加段位</Button>
                </div>
                {newRank?.platform === platform.key && (
                  <div className="grid gap-3 rounded-sm border border-[var(--color-border)] p-4 sm:grid-cols-[1fr_1fr_auto]">
                    <div className="space-y-1.5"><Label>显示名称</Label><Input value={newRank.label} onChange={(event) => setNewRank({ ...newRank, label: event.target.value, rankKey: newRank.rankKey })} placeholder="例如 S+" /></div>
                    <div className="space-y-1.5"><Label>稳定段位标识（创建后不可修改）</Label><Input value={newRank.rankKey} onChange={(event) => setNewRank({ ...newRank, rankKey: event.target.value })} placeholder="例如 c_plus、C+ 或 青铜S" className="font-mono" /></div>
                    <div className="flex items-end gap-2">
                      <Button type="button" size="sm" disabled={pending || !newRank.label.trim() || !newRank.rankKey.trim()} onClick={() => run(() => createCompetitivePlatformRank({ platform: newRank.platform, label: newRank.label, rankKey: newRank.rankKey.trim() }), "段位已添加")}>创建</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setNewRank(null)}>取消</Button>
                    </div>
                  </div>
                )}
                {ranks.length === 0 && <p className="text-sm text-[var(--color-fg-mid)]">该平台还没有段位表。段位表属于平台本身，所有赛季共用；参赛者与赛事资格都会使用这里的顺序。</p>}
                <div className="divide-y divide-[var(--color-border)] rounded-sm border border-[var(--color-border)]">
                  {ranks.map((rank, index) => (
                    <div key={rank.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="font-mono text-xs text-[var(--color-fg-dim)]">{index + 1}</span>
                        {rankLabelDraft?.id === rank.id ? (
                          <div className="flex items-center gap-2">
                            <Input value={rankLabelDraft.label} onChange={(event) => setRankLabelDraft({ ...rankLabelDraft, label: event.target.value })} className="max-w-40" />
                            <Button type="button" size="sm" disabled={pending || !rankLabelDraft.label.trim()} onClick={() => run(() => updateCompetitivePlatformRankLabel(rankLabelDraft), "段位显示名称已更新")}>保存</Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setRankLabelDraft(null)}>取消</Button>
                          </div>
                        ) : (
                          <p className="font-medium">{rank.label} <span className="ml-1 font-mono text-xs text-[var(--color-fg-dim)]">{rank.rankKey}</span></p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-sm">
                        <Button type="button" size="sm" variant="ghost" disabled={pending || index === 0} onClick={() => run(() => moveCompetitivePlatformRank({ id: rank.id, direction: "up" }), "段位顺序已更新")} title="上移（更低段位方向）">↑</Button>
                        <Button type="button" size="sm" variant="ghost" disabled={pending || index === ranks.length - 1} onClick={() => run(() => moveCompetitivePlatformRank({ id: rank.id, direction: "down" }), "段位顺序已更新")} title="下移（更高段位方向）">↓</Button>
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setRankLabelDraft({ id: rank.id, label: rank.label })}>重命名</Button>
                        <Button type="button" size="sm" variant="ghost" className="text-[var(--color-danger)]" disabled={pending} onClick={() => setConfirmAction({ kind: "delete-rank", id: rank.id, title: `删除段位 ${rank.label}？`, sub: "已被竞技资料或已发布赛事引用的段位无法删除。" })}>删除</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </Panel>
        );
      })}

      <Dialog open={Boolean(confirmAction)} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        {confirmAction && <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{confirmAction.kind === "set-current" ? "切换当前赛季" : "确认删除"}</DialogTitle><DialogDescription className="sr-only">请确认这项竞技平台目录操作。</DialogDescription></DialogHeader>
              {confirmAction.kind === "set-current" ? (
                <InlineConfirm
                  title={confirmAction.title}
                  sub={confirmAction.sub}
                  confirmLabel="确认切换"
                  onConfirm={() => { const action = confirmAction; setConfirmAction(null); run(() => setCurrentCompetitivePlatformSeason({ id: action.id }), "当前赛季已切换"); }}
                  onCancel={() => setConfirmAction(null)}
                />
              ) : (
                <InlineConfirm
                  danger
                  title={confirmAction.title}
                  sub={confirmAction.sub}
                  confirmLabel="确认删除"
                  onConfirm={() => {
                    const action = confirmAction;
                    setConfirmAction(null);
                    run(
                      () => action.kind === "delete-season" ? deleteCompetitivePlatformSeason({ id: action.id }) : deleteCompetitivePlatformRank({ id: action.id }),
                      action.kind === "delete-season" ? "赛季已删除" : "段位已删除",
                    );
                  }}
                  onCancel={() => setConfirmAction(null)}
                />
              )}
        </DialogContent>}
      </Dialog>
    </div>
  );
}

/**
 * Platform identity: the canonical performance Rating is product-defined and
 * therefore display-only; operators may only rename the display name.
 */
function PlatformIdentityRow({ key_, displayName, ratingLabel, pending, onSave }: { key_: string; displayName: string; ratingLabel: string; pending: boolean; onSave: (displayName: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName);
  if (!editing) {
    return (
      <div className="space-y-1">
        <p className="text-lg font-semibold">{displayName}</p>
        <p className="font-mono text-xs text-[var(--color-fg-dim)]">{key_}</p>
        <p className="text-sm text-[var(--color-fg-mid)]">平台官方竞技评分：{ratingLabel}（由产品定义，不可在后台修改）</p>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setDraft(displayName); setEditing(true); }}>修改平台信息</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={draft} onChange={(event) => setDraft(event.target.value)} className="max-w-64" aria-label="平台显示名称" />
        <Button type="button" size="sm" disabled={pending || !draft.trim()} onClick={() => { onSave(draft); setEditing(false); }}>保存</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>取消</Button>
      </div>
      <p className="font-mono text-xs text-[var(--color-fg-dim)]">{key_} · 平台标识与官方竞技评分由产品定义，不可修改</p>
    </div>
  );
}
