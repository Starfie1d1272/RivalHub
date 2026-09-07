"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  approveConversionPolicyAction,
  createConversionPolicyDraftAction,
  retireConversionPolicyAction,
  setCurrentConversionPolicyAction,
  updateConversionPolicyDraftAction,
} from "@/actions/conversion-policies";
import {
  BUILT_IN_COMPETITIVE_PLATFORMS,
  type BuiltInRankDefinition,
} from "@/lib/competitive/builtins";
import {
  validateConversionPolicyMapping,
  type ConversionPolicyMapping,
  type StarSegment,
} from "@/lib/competitive/conversion-policy";
import type { ConversionPolicyAdminRow } from "@/lib/competitive/conversion-policy-admin";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { InlineConfirm, Panel, StatusPill } from "@/components/rivalhub";

const fivee = BUILT_IN_COMPETITIVE_PLATFORMS.fivee;
const perfectWorld = BUILT_IN_COMPETITIVE_PLATFORMS.perfect_world;
const fiveeBelowSRanks = fivee.ranks.filter((rank) => rank.starMin === null);
const perfectWorldRanks = perfectWorld.ranks;
const perfectWorldBelowSRanks = perfectWorld.ranks.filter((rank) => rank.starMin === null);

type Confirmation = "approve" | "set-current" | "retire";

interface EditorState {
  mapping: ConversionPolicyMapping;
  sourceNote: string;
  rationale: string;
  changeSummary: string;
  internalNote: string;
}

interface NewDraftState {
  basePolicyId: string;
  version: string;
  sourceNote: string;
  rationale: string;
  changeSummary: string;
  internalNote: string;
}

function cloneMapping(mapping: ConversionPolicyMapping): ConversionPolicyMapping {
  return {
    belowSRankMap: { ...mapping.belowSRankMap },
    starSegments: mapping.starSegments.map((segment) => ({ ...segment })),
    relativeSeasonAlignment: true,
  };
}

function editorFromPolicy(policy: ConversionPolicyAdminRow): EditorState {
  return {
    mapping: cloneMapping(policy.mapping),
    sourceNote: policy.sourceNote ?? "",
    rationale: policy.rationale ?? "",
    changeSummary: policy.changeSummary ?? "",
    internalNote: policy.internalNote ?? "",
  };
}

function policyStatusLabel(status: ConversionPolicyAdminRow["status"]): string {
  return status === "draft" ? "草稿" : status === "approved" ? "已批准" : "已退役";
}

function policyStatusTone(status: ConversionPolicyAdminRow["status"]): "neutral" | "success" | "danger" {
  return status === "draft" ? "neutral" : status === "approved" ? "success" : "danger";
}

function platformLabel(key: string): string {
  return key === "fivee" ? "5E" : key === "perfect_world" ? "Perfect World" : key;
}

function formatDate(value: Date | string | null): string {
  if (!value) return "未配置";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function rankLabel(rank: BuiltInRankDefinition): string {
  return rank.label === rank.rankKey ? rank.rankKey : `${rank.label}（${rank.rankKey}）`;
}

export function ConversionPolicyManager({ initialPolicies }: { initialPolicies: ConversionPolicyAdminRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [newDraft, setNewDraft] = useState<NewDraftState | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const selected = useMemo(() => initialPolicies.find((policy) => policy.id === selectedId) ?? null, [initialPolicies, selectedId]);

  const approvedBases = initialPolicies.filter((policy) => policy.status === "approved" || policy.status === "retired");
  const defaultBase = initialPolicies.find((policy) => policy.isCurrent && policy.status === "approved") ?? approvedBases[0];

  function openPolicy(policy: ConversionPolicyAdminRow) {
    setSelectedId(policy.id);
    setEditor(editorFromPolicy(policy));
    setConfirmation(null);
  }

  function closePolicy() {
    if (pending) return;
    setSelectedId(null);
    setEditor(null);
    setConfirmation(null);
  }

  function runAction(work: () => Promise<{ success: boolean; error?: { message: string } }>, successMessage: string, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await work();
      if (!result.success) {
        toast.error(result.error?.message ?? "操作失败，请稍后重试。 ");
        return;
      }
      toast.success(successMessage);
      onSuccess?.();
      router.refresh();
    });
  }

  function updateBelowSRank(sourceRank: string, target: string) {
    setEditor((current) => current ? {
      ...current,
      mapping: { ...current.mapping, belowSRankMap: { ...current.mapping.belowSRankMap, [sourceRank]: target } },
    } : current);
  }

  function updateSegment(index: number, key: keyof StarSegment, value: string) {
    setEditor((current) => {
      if (!current) return current;
      const starSegments = current.mapping.starSegments.map((segment, segmentIndex) => {
        if (segmentIndex !== index) return segment;
        if (key === "maxStar" && value === "") return { ...segment, maxStar: null };
        if (key === "targetRank") return { ...segment, targetRank: value };
        if (key === "targetStarFloor") return { ...segment, targetStarFloor: value === "" ? null : Number(value) };
        return { ...segment, [key]: Number(value) };
      });
      return { ...current, mapping: { ...current.mapping, starSegments } };
    });
  }

  function addSegment() {
    setEditor((current) => {
      if (!current) return current;
      const segments = current.mapping.starSegments;
      const last = segments[segments.length - 1];
      if (!last || last.maxStar === null) {
        const minStar = (last?.minStar ?? 0) + 1;
        const updated = last
          ? [...segments.slice(0, -1), { ...last, maxStar: minStar - 1 }]
          : segments;
        updated.push({ minStar, maxStar: null, targetRank: "魔王S", targetStarFloor: 50, slopeNum: 1, slopeDen: 1 });
        return { ...current, mapping: { ...current.mapping, starSegments: updated } };
      }
      const minStar = last.maxStar + 1;
      return {
        ...current,
        mapping: {
          ...current.mapping,
          starSegments: [...segments.slice(0, -1), { ...last }, { minStar, maxStar: null, targetRank: "魔王S", targetStarFloor: 50, slopeNum: 1, slopeDen: 1 }],
        },
      };
    });
  }

  function removeSegment(index: number) {
    setEditor((current) => current && current.mapping.starSegments.length > 1
      ? { ...current, mapping: { ...current.mapping, starSegments: current.mapping.starSegments.filter((_, segmentIndex) => segmentIndex !== index) } }
      : current);
  }

  function saveDraft() {
    if (!selected || !editor) return;
    try {
      validateConversionPolicyMapping(editor.mapping);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "mapping 无效。 ");
      return;
    }
    runAction(
      () => updateConversionPolicyDraftAction({ id: selected.id, mapping: editor.mapping, sourceNote: editor.sourceNote, rationale: editor.rationale, changeSummary: editor.changeSummary, internalNote: editor.internalNote }),
      "换算策略草稿已保存",
    );
  }

  function confirmLifecycleAction() {
    if (!selected || !confirmation) return;
    const action = confirmation;
    setConfirmation(null);
    const work = action === "approve"
      ? () => approveConversionPolicyAction({ id: selected.id })
      : action === "set-current"
        ? () => setCurrentConversionPolicyAction({ id: selected.id })
        : () => retireConversionPolicyAction({ id: selected.id });
    const message = action === "approve" ? "换算策略已批准" : action === "set-current" ? "当前换算策略已切换" : "换算策略已退役";
    runAction(work, message);
  }

  function createDraft() {
    if (!newDraft) return;
    if (!newDraft.basePolicyId || !newDraft.version.trim()) {
      toast.error("请选择基准策略并填写新的版本号。 ");
      return;
    }
    const draft = newDraft;
    runAction(
      () => createConversionPolicyDraftAction({ basePolicyId: draft.basePolicyId, version: draft.version, sourceNote: draft.sourceNote, rationale: draft.rationale, changeSummary: draft.changeSummary, internalNote: draft.internalNote }),
      "换算策略草稿已创建",
      () => setNewDraft(null),
    );
  }

  return (
    <Panel label="策略版本目录" contentClassName="p-0">
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--color-fg-mid)]">完整 mapping 只在详情中查看；批准后版本与 mapping 均不可修改。</p>
          <Button
            type="button"
            size="sm"
            disabled={pending || approvedBases.length === 0}
            onClick={() => setNewDraft({ basePolicyId: defaultBase?.id ?? "", version: "", sourceNote: defaultBase?.sourceNote ?? "", rationale: defaultBase?.rationale ?? "", changeSummary: "", internalNote: "" })}
          >
            + 新建版本
          </Button>
        </div>

        {initialPolicies.length === 0 ? (
          <p className="rounded-sm border border-[var(--color-border)] px-4 py-6 text-sm text-[var(--color-fg-mid)]">尚未有可复制的 ConversionPolicy。请先通过 migration 准备首个 approved policy。</p>
        ) : (
          <div className="overflow-x-auto rounded-sm border border-[var(--color-border)]">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-[var(--color-border)] bg-[var(--color-panel-low)] text-xs text-[var(--color-fg-mid)]">
                <tr>
                  <th className="px-4 py-3 font-medium">版本</th>
                  <th className="px-4 py-3 font-medium">换算方向</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">创建时间</th>
                  <th className="px-4 py-3 font-medium">批准信息</th>
                  <th className="px-4 py-3 font-medium">绑定赛事</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {initialPolicies.map((policy) => (
                  <tr key={policy.id} className="align-top">
                    <td className="px-4 py-3 font-mono font-medium">{policy.version}</td>
                    <td className="px-4 py-3">{platformLabel(policy.sourcePlatform)} → {platformLabel(policy.targetPlatform)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <StatusPill label={policyStatusLabel(policy.status)} tone={policyStatusTone(policy.status)} />
                        {policy.isCurrent && <StatusPill label="当前" tone="accent" />}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--color-fg-mid)]">{formatDate(policy.createdAt)}</td>
                    <td className="px-4 py-3 text-xs text-[var(--color-fg-mid)]">{policy.approvedAt ? `${formatDate(policy.approvedAt)} · ${policy.approvedByLabel ?? "未知管理员"}` : "未批准"}</td>
                    <td className="px-4 py-3">{policy.eventReferences.length}</td>
                    <td className="px-4 py-3 text-right"><Button type="button" size="sm" variant="outline" onClick={() => openPolicy(policy)}>查看详情</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={Boolean(newDraft)} onOpenChange={(open) => { if (!open && !pending) setNewDraft(null); }}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>新建 ConversionPolicy 版本</DialogTitle>
            <DialogDescription>必须从已有 policy 复制 mapping；新版本初始为草稿，批准前仍可修改。</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {newDraft && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="conversion-policy-base-policy">基准策略</Label><Select value={newDraft.basePolicyId} onValueChange={(value) => setNewDraft({ ...newDraft, basePolicyId: value })}><SelectTrigger id="conversion-policy-base-policy"><SelectValue placeholder="选择已有策略" /></SelectTrigger><SelectContent>{approvedBases.map((policy) => <SelectItem key={policy.id} value={policy.id}>{policy.version} · {policyStatusLabel(policy.status)}{policy.isCurrent ? " · 当前" : ""}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label htmlFor="conversion-policy-new-version">新版本号</Label><Input id="conversion-policy-new-version" value={newDraft.version} onChange={(event) => setNewDraft({ ...newDraft, version: event.target.value })} placeholder="例如 2026.10" /></div>
                </div>
                <NotesEditor value={newDraft} onChange={(value) => setNewDraft(value)} includeInternal />
              </>
            )}
          </DialogBody>
          <DialogFooter><Button type="button" variant="ghost" onClick={() => setNewDraft(null)}>取消</Button><Button type="button" disabled={pending} onClick={createDraft}>创建草稿</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selected && editor)} onOpenChange={(open) => { if (!open) closePolicy(); }}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>{selected ? `ConversionPolicy ${selected.version}` : "ConversionPolicy"}</DialogTitle>
            <DialogDescription>{selected ? `${platformLabel(selected.sourcePlatform)} → ${platformLabel(selected.targetPlatform)} · stable ID ${selected.id}` : ""}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-6">
            {selected && editor && (
              <>
                <div className="flex flex-wrap items-center gap-2"><StatusPill label={policyStatusLabel(selected.status)} tone={policyStatusTone(selected.status)} />{selected.isCurrent && <StatusPill label="当前" tone="accent" />}</div>
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <Fact label="创建时间" value={formatDate(selected.createdAt)} />
                  <Fact label="更新时间" value={formatDate(selected.updatedAt)} />
                  <Fact label="批准时间" value={formatDate(selected.approvedAt)} />
                  <Fact label="批准人" value={selected.approvedByLabel ?? "未批准"} />
                </div>

                <section className="space-y-3"><h3 className="text-sm font-semibold">来源与说明</h3><NotesEditor value={editor} onChange={(value) => setEditor(value)} includeInternal={selected.status === "draft" || Boolean(editor.internalNote)} readOnly={selected.status !== "draft"} /></section>
                <section className="space-y-4"><h3 className="text-sm font-semibold">5E 非 S 段位映射</h3><div className="overflow-x-auto rounded-sm border border-[var(--color-border)]"><table className="w-full min-w-[520px] text-left text-sm"><thead className="border-b border-[var(--color-border)] bg-[var(--color-panel-low)] text-xs text-[var(--color-fg-mid)]"><tr><th className="px-3 py-2 font-medium">5E 段位</th><th className="px-3 py-2 font-medium">Perfect World 目标段位</th></tr></thead><tbody className="divide-y divide-[var(--color-border)]">{fiveeBelowSRanks.map((rank) => { const selectId = `conversion-policy-below-s-${rank.rankKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`; return <tr key={rank.rankKey}><td className="px-3 py-2 font-medium">{rankLabel(rank)}</td><td className="px-3 py-2"><Label className="sr-only" htmlFor={selectId}>「{rankLabel(rank)}」对应的 Perfect World 目标段位</Label><Select disabled={selected.status !== "draft"} value={editor.mapping.belowSRankMap[rank.rankKey] ?? ""} onValueChange={(value) => updateBelowSRank(rank.rankKey, value)}><SelectTrigger id={selectId}><SelectValue /></SelectTrigger><SelectContent>{perfectWorldBelowSRanks.map((target) => <SelectItem key={target.rankKey} value={target.rankKey}>{rankLabel(target)}</SelectItem>)}</SelectContent></Select></td></tr>; })}</tbody></table></div></section>
                <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">S 段星数分段</h3><p className="mt-1 text-xs text-[var(--color-fg-mid)]">min / max 为 5E 总星数；最后一段的 max 留空表示开放上限。</p></div>{selected.status === "draft" && <Button type="button" size="sm" variant="outline" onClick={addSegment}>+ 增加分段</Button>}</div><div className="space-y-3">{editor.mapping.starSegments.map((segment, index) => <StarSegmentEditor key={`${index}-${segment.minStar}`} segment={segment} index={index} editable={selected.status === "draft"} onChange={updateSegment} onRemove={removeSegment} canRemove={editor.mapping.starSegments.length > 1} />)}</div></section>

                {selected.eventReferences.length > 0 && <section className="space-y-3"><h3 className="text-sm font-semibold">赛事引用</h3><ul className="space-y-2">{selected.eventReferences.map((reference) => <li key={reference.seasonId} className="rounded-sm border border-[var(--color-border)] px-3 py-2 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{reference.seasonName} <span className="font-mono text-xs text-[var(--color-fg-dim)]">{reference.seasonSlug}</span></span><StatusPill label={reference.referenceState === "registration_frozen" ? "已开放并冻结" : "已发布锁定版本"} tone="info" /></div><p className="mt-1 text-xs text-[var(--color-fg-mid)]">版本 {reference.policyVersion ?? "未记录"} · 赛事状态 {reference.seasonStatus} · {reference.registrationOpenedAt ? `开放于 ${formatDate(reference.registrationOpenedAt)}` : "报名尚未开放"}</p></li>)}</ul></section>}
              </>
            )}
            {confirmation && selected && <InlineConfirm danger={confirmation === "retire"} title={confirmation === "approve" ? "批准这份 policy 版本？" : confirmation === "set-current" ? "将这份 policy 设为当前版本？" : "退役这份历史 policy？"} sub={confirmation === "set-current" ? "已发布或已开放赛事的锁定版本不会被修改。" : confirmation === "retire" ? "退役后不能恢复或编辑，但历史赛事引用仍可读取。" : "批准后 mapping 与版本身份将不可修改。"} confirmLabel="确认操作" onCancel={() => setConfirmation(null)} onConfirm={confirmLifecycleAction} />}
          </DialogBody>
          <DialogFooter>
            {selected?.status === "draft" && <Button type="button" variant="outline" disabled={pending} onClick={saveDraft}>保存草稿</Button>}
            {selected?.status === "draft" && <Button type="button" disabled={pending} onClick={() => setConfirmation("approve")}>批准版本</Button>}
            {selected?.status === "approved" && !selected.isCurrent && <Button type="button" disabled={pending} onClick={() => setConfirmation("set-current")}>设为当前版本</Button>}
            {selected?.status === "approved" && !selected.isCurrent && <Button type="button" variant="destructive" disabled={pending} onClick={() => setConfirmation("retire")}>退役版本</Button>}
            <Button type="button" variant="ghost" onClick={closePolicy}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[var(--color-fg-mid)]">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>;
}

function NotesEditor<T extends { sourceNote: string; rationale: string; changeSummary: string; internalNote: string }>({ value, onChange, includeInternal, readOnly = false }: { value: T; onChange: (value: T) => void; includeInternal: boolean; readOnly?: boolean }) {
  const update = (key: keyof T, nextValue: string) => onChange({ ...value, [key]: nextValue });
  return <div className="grid gap-4 sm:grid-cols-2"><NoteField id="conversion-source-note" label="来源说明" value={value.sourceNote} onChange={(nextValue) => update("sourceNote", nextValue)} readOnly={readOnly} /><NoteField id="conversion-rationale" label="采用理由" value={value.rationale} onChange={(nextValue) => update("rationale", nextValue)} readOnly={readOnly} /><NoteField id="conversion-change-summary" label="相对上一版的变化" value={value.changeSummary} onChange={(nextValue) => update("changeSummary", nextValue)} readOnly={readOnly} /><div className="sm:col-span-2">{includeInternal && <NoteField id="conversion-internal-note" label="内部备注（仅 super admin）" value={value.internalNote} onChange={(nextValue) => update("internalNote", nextValue)} readOnly={readOnly} />}</div></div>;
}

function NoteField({ id, label, value, onChange, readOnly }: { id: string; label: string; value: string; onChange: (value: string) => void; readOnly: boolean }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Textarea id={id} value={value} readOnly={readOnly} disabled={readOnly} onChange={(event) => onChange(event.target.value)} /></div>;
}

function StarSegmentEditor({ segment, index, editable, onChange, onRemove, canRemove }: { segment: StarSegment; index: number; editable: boolean; onChange: (index: number, key: keyof StarSegment, value: string) => void; onRemove: (index: number) => void; canRemove: boolean }) {
  const fieldId = (name: string) => `conversion-policy-segment-${index}-${name}`;
  const targetRankId = fieldId("target-rank");
  return <div className="rounded-sm border border-[var(--color-border)] p-3"><div className="mb-3 flex items-center justify-between gap-2"><span className="text-xs font-semibold text-[var(--color-fg-mid)]">分段 {index + 1}</span>{editable && <Button type="button" size="sm" variant="ghost" disabled={!canRemove} onClick={() => onRemove(index)}>删除</Button>}</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><NumberField id={fieldId("min-star")} label="minStar" value={segment.minStar} disabled={!editable} onChange={(value) => onChange(index, "minStar", value)} /><NumberField id={fieldId("max-star")} label="maxStar（最后一段可空）" value={segment.maxStar ?? ""} disabled={!editable} onChange={(value) => onChange(index, "maxStar", value)} /><div className="space-y-2"><Label htmlFor={targetRankId}>目标段位</Label><Select disabled={!editable} value={segment.targetRank} onValueChange={(value) => onChange(index, "targetRank", value)}><SelectTrigger id={targetRankId}><SelectValue /></SelectTrigger><SelectContent>{perfectWorldRanks.map((rank) => <SelectItem key={rank.rankKey} value={rank.rankKey}>{rankLabel(rank)}</SelectItem>)}</SelectContent></Select></div><NumberField id={fieldId("target-star-floor")} label="targetStarFloor（无星目标可空）" value={segment.targetStarFloor ?? ""} disabled={!editable} onChange={(value) => onChange(index, "targetStarFloor", value)} /><NumberField id={fieldId("slope-num")} label="slopeNum" value={segment.slopeNum} disabled={!editable} onChange={(value) => onChange(index, "slopeNum", value)} /><NumberField id={fieldId("slope-den")} label="slopeDen" value={segment.slopeDen} disabled={!editable} onChange={(value) => onChange(index, "slopeDen", value)} /></div></div>;
}

function NumberField({ id, label, value, disabled, onChange }: { id: string; label: string; value: number | string; disabled: boolean; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} type="number" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></div>;
}
