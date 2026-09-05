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
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InlineConfirm, Panel, StatusBanner } from "@/components/rivalhub";

type Platform = CompetitivePlatformCatalogEntry;

type Run = (work: () => Promise<{ success: boolean; error?: { message: string } }>, okMessage: string, onSuccess?: () => void) => void;

type NewSeasonDraft = {
  platform: string;
  seasonKey: string;
  seasonKeyManuallyEdited: boolean;
  label: string;
  chronology: string;
  showAdvancedSeasonKey: boolean;
};

type SeasonChronologyOption = {
  value: string;
  label: string;
  insertAt?: { seasonId: string; position: "before" | "after" };
};

function suggestedSeasonKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, "-");
}

function seasonKeyForDraft(draft: NewSeasonDraft): string {
  return (draft.seasonKeyManuallyEdited ? draft.seasonKey : suggestedSeasonKey(draft.label)).trim().toLowerCase();
}

/**
 * The catalog is displayed newest-first, while the action inserts into its
 * oldest-first chronology. For a visible gap, anchoring on the older season
 * and inserting after it preserves the intended final position.
 */
function buildSeasonChronologyOptions(seasons: Platform["seasons"]): SeasonChronologyOption[] {
  const options: SeasonChronologyOption[] = [{ value: "latest", label: "作为最新赛季" }];
  for (let index = 0; index < seasons.length - 1; index += 1) {
    const newer = seasons[index];
    const older = seasons[index + 1];
    if (!newer || !older) continue;
    options.push({
      value: `gap:${older.id}`,
      label: `位于 ${newer.label} 与 ${older.label} 之间`,
      insertAt: { seasonId: older.id, position: "after" },
    });
  }
  const oldest = seasons[seasons.length - 1];
  if (oldest) {
    options.push({
      value: `before:${oldest.id}`,
      label: `早于最早赛季（${oldest.label}）`,
      insertAt: { seasonId: oldest.id, position: "before" },
    });
  }
  return options;
}

function useCatalogActions() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run: Run = (work, okMessage, onSuccess) => startTransition(async () => {
    const result = await work();
    if (result.success) { toast.success(okMessage); onSuccess?.(); router.refresh(); }
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
  const [newSeason, setNewSeason] = useState<NewSeasonDraft | null>(null);
  const [seasonLabelDraft, setSeasonLabelDraft] = useState<{ id: string; label: string } | null>(null);
  const [newRank, setNewRank] = useState<{ platform: string; label: string; rankKey: string } | null>(null);
  const [rankLabelDraft, setRankLabelDraft] = useState<{ id: string; label: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ kind: "set-current" | "delete-season" | "delete-rank"; id: string; title: string; sub?: string } | null>(null);
  const newSeasonPlatform = newSeason ? platforms.find((platform) => platform.key === newSeason.platform) : undefined;
  const newSeasonSeasons = newSeasonPlatform ? [...newSeasonPlatform.seasons].sort((a, b) => b.sortOrder - a.sortOrder) : [];
  const newSeasonChronologyOptions = buildSeasonChronologyOptions(newSeasonSeasons);
  const selectedNewSeasonChronology = newSeasonChronologyOptions.find((option) => option.value === newSeason?.chronology);
  const newSeasonKey = newSeason ? seasonKeyForDraft(newSeason) : "";
  const canCreateSeason = Boolean(newSeason?.label.trim() && newSeasonKey && selectedNewSeasonChronology);

  const submitNewSeason = () => {
    if (!newSeason || !newSeason.label.trim() || !newSeasonKey || !selectedNewSeasonChronology) return;
    const draft = newSeason;
    const chronology = selectedNewSeasonChronology;
    run(
      () => createCompetitivePlatformSeason({
        platform: draft.platform,
        seasonKey: newSeasonKey,
        label: draft.label,
        ...(chronology.insertAt ? { insertAt: chronology.insertAt } : {}),
      }),
      "赛季已新增",
      () => setNewSeason(null),
    );
  };

  return (
    <div className="space-y-5">
      {platforms.length === 0 && <StatusBanner tone="warn" title="内置竞技平台目录未就绪" sub="2.0 内置 Perfect World 与 5E；若目录没有出现，请检查 active migration，而不是在后台临时创建新平台。" />}

      {platforms.map((platform) => {
        const ranks = [...platform.ranks].sort((a, b) => a.sortOrder - b.sortOrder);
        const seasons = [...platform.seasons].sort((a, b) => b.sortOrder - a.sortOrder);
        return (
          <Panel key={platform.key} label={platform.displayName} contentClassName="p-0">
            <div className="space-y-5 p-5">
              {/* Platform identity */}
              <div className="flex flex-wrap items-end justify-between gap-3">
                <PlatformIdentityRow key_={platform.key} displayName={platform.displayName} ratingLabel={platform.ratingLabel} pending={pending} onSave={(displayName) => run(() => updateCompetitivePlatform({ key: platform.key, displayName }), "平台目录已更新")} />
              </div>

              {/* Seasons */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">赛季</h3>
                  <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setNewSeason({ platform: platform.key, seasonKey: "", seasonKeyManuallyEdited: false, label: "", chronology: "latest", showAdvancedSeasonKey: false })}>+ 新增赛季</Button>
                </div>
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

      <Dialog open={Boolean(newSeason)} onOpenChange={(open) => { if (!open) setNewSeason(null); }}>
        {newSeason && newSeasonPlatform && (
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>新增历史赛季</DialogTitle>
              <DialogDescription>补录赛季目录并选择它在时间线中的位置。创建后不会自动成为当前赛季。</DialogDescription>
            </DialogHeader>

            <form className="contents" onSubmit={(event) => { event.preventDefault(); submitNewSeason(); }}>
              <DialogBody className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="new-season-label">赛季名称</Label>
                <Input
                  id="new-season-label"
                  autoFocus
                  value={newSeason.label}
                  onChange={(event) => setNewSeason({ ...newSeason, label: event.target.value })}
                  placeholder="例如 2025 S4"
                />
                <p className="text-xs text-[var(--color-fg-mid)]">这是管理员和参赛资料中展示的赛季名称。</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-season-chronology">时间位置</Label>
                <Select
                  value={newSeason.chronology}
                  onValueChange={(chronology) => setNewSeason({ ...newSeason, chronology })}
                  disabled={pending}
                >
                  <SelectTrigger id="new-season-chronology" aria-label="时间位置">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {newSeasonChronologyOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-[var(--color-fg-mid)]">直接选择创建后希望看到的时间位置。</p>
              </div>

              <div className="rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-[var(--color-fg-mid)]">稳定标识</p>
                    <p className="mt-1 text-sm">
                      {newSeason.seasonKeyManuallyEdited ? "将使用：" : "将自动生成："}
                      <span className="font-mono">{newSeasonKey || (newSeason.seasonKeyManuallyEdited ? "待填写" : "输入名称后生成")}</span>
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-expanded={newSeason.showAdvancedSeasonKey}
                    aria-controls="new-season-stable-key"
                    onClick={() => setNewSeason({ ...newSeason, showAdvancedSeasonKey: !newSeason.showAdvancedSeasonKey })}
                  >
                    {newSeason.showAdvancedSeasonKey ? "收起高级设置" : "高级设置"}
                  </Button>
                </div>
                {newSeason.showAdvancedSeasonKey && (
                  <div className="mt-3 space-y-1.5">
                    <Label htmlFor="new-season-stable-key">稳定标识（创建后不可修改）</Label>
                    <Input
                      id="new-season-stable-key"
                      value={newSeason.seasonKeyManuallyEdited ? newSeason.seasonKey : suggestedSeasonKey(newSeason.label)}
                      onChange={(event) => setNewSeason({ ...newSeason, seasonKey: event.target.value, seasonKeyManuallyEdited: true })}
                      placeholder={suggestedSeasonKey(newSeason.label) || "例如 2025-s4"}
                      className="font-mono"
                    />
                    <p className="text-xs text-[var(--color-fg-mid)]">仅在需要对齐既有外部标识时修改；名称变化不会覆盖人工设置。</p>
                  </div>
                )}
              </div>

              <div className="space-y-2 rounded-sm border border-[var(--color-border)] p-3" aria-live="polite">
                <p className="text-sm font-semibold">创建前确认</p>
                <div className="space-y-1 text-sm">
                  <p>名称：{newSeason.label.trim() || "未填写"}</p>
                  <p>稳定标识：{newSeasonKey || (newSeason.seasonKeyManuallyEdited ? "待填写" : "输入名称后生成")}</p>
                  <p>时间位置：{selectedNewSeasonChronology?.label ?? "请选择时间位置"}</p>
                </div>
                <p className="pt-1 text-xs font-medium text-[var(--color-fg-mid)]">创建后不会自动成为当前赛季</p>
              </div>

              </DialogBody>
              <DialogFooter className="gap-2">
                <Button type="button" variant="ghost" onClick={() => setNewSeason(null)}>取消</Button>
                <Button type="submit" disabled={pending || !canCreateSeason}>{pending ? "添加中..." : "添加赛季"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={Boolean(confirmAction)} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        {confirmAction && <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{confirmAction.kind === "set-current" ? "切换当前赛季" : "确认删除"}</DialogTitle><DialogDescription className="sr-only">请确认这项竞技平台目录操作。</DialogDescription></DialogHeader>
          <DialogBody>
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
          </DialogBody>
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
