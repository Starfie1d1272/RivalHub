"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createCommunityGroup, createSeasonContact, deleteCommunityGroup, deleteSeasonContact, moveCommunityGroup, moveSeasonContact, removeCommunityGroupQr, saveSeasonPublicInfo, updateCommunityGroup, updateSeasonContact, uploadCommunityGroupQr } from "@/actions/season-public-info";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LOGO_ALLOWED_TYPES, LOGO_MAX_BYTES } from "@/lib/config/upload-limits";
import type { SeasonPublicInfoAdmin } from "@/lib/season-public-info/read-model";

type AsyncResult = Promise<{ success: boolean; error?: { message: string } }>;
type GroupRow = SeasonPublicInfoAdmin["groups"][number];
type ContactRow = SeasonPublicInfoAdmin["contacts"][number];

export function SeasonPublicInfoManager({ data }: { data: SeasonPublicInfoAdmin }) {
  const [pending, startTransition] = useTransition();
  const [rulesLabel, setRulesLabel] = useState(data.info?.rulesLabel ?? "赛事规则");
  const [rulesHref, setRulesHref] = useState(data.info?.rulesHref ?? "/rules");
  const [group, setGroup] = useState({ label: "", audience: "", groupNumber: "", joinUrl: "", note: "" });
  const [contact, setContact] = useState({ label: "", publicName: "", value: "", href: "", note: "" });
  const run = (work: () => AsyncResult, message: string) => startTransition(async () => {
    const result = await work();
    if (!result.success) toast.error(result.error?.message ?? "操作失败。 ");
    else { toast.success(message); window.location.reload(); }
  });
  return (
    <div className="space-y-6">
      <section className="space-y-4 border border-[var(--color-border)] bg-[var(--color-panel-low)] p-5">
        <div><h2 className="text-lg font-semibold text-[var(--color-fg)]">规则入口</h2><p className="mt-1 text-sm text-[var(--color-fg-mid)]">只维护规则页面入口，不复制规则正文。</p></div>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="显示名称" value={rulesLabel} onChange={setRulesLabel} /><Field label="链接" value={rulesHref} onChange={setRulesHref} /></div>
        <Button disabled={pending} onClick={() => run(() => saveSeasonPublicInfo({ seasonId: data.season.id, rulesLabel, rulesHref }), "规则入口已保存")}>保存规则入口</Button>
      </section>

      <section className="space-y-4 border border-[var(--color-border)] bg-[var(--color-panel-low)] p-5">
        <div><h2 className="text-lg font-semibold text-[var(--color-fg)]">交流群</h2><p className="mt-1 text-sm text-[var(--color-fg-mid)]">支持任意数量；启用中的群至少配置群号、二维码或加入链接之一。</p></div>
        <div className="grid gap-3">{data.groups.map((item, index) => <GroupEditor key={item.id} item={item} index={index} total={data.groups.length} pending={pending} run={run} />)}</div>
        <div className="grid gap-3 border-t border-[var(--color-border)] pt-4 md:grid-cols-2"><Field label="名称" value={group.label} onChange={(value) => setGroup((current) => ({ ...current, label: value }))} /><Field label="面向人群" value={group.audience} onChange={(value) => setGroup((current) => ({ ...current, audience: value }))} /><Field label="群号" value={group.groupNumber} onChange={(value) => setGroup((current) => ({ ...current, groupNumber: value }))} /><Field label="加入链接" value={group.joinUrl} onChange={(value) => setGroup((current) => ({ ...current, joinUrl: value }))} /><div className="space-y-2 md:col-span-2"><Label>说明</Label><Textarea rows={2} value={group.note} onChange={(event) => setGroup((current) => ({ ...current, note: event.target.value }))} /></div><Button disabled={pending || !group.label.trim() || (!group.groupNumber.trim() && !group.joinUrl.trim())} onClick={() => run(async () => { const result = await createCommunityGroup({ seasonId: data.season.id, ...group }); if (result.success) setGroup({ label: "", audience: "", groupNumber: "", joinUrl: "", note: "" }); return result; }, "交流群已创建")}>新增交流群</Button></div>
      </section>

      <section className="space-y-4 border border-[var(--color-border)] bg-[var(--color-panel-low)] p-5">
        <div><h2 className="text-lg font-semibold text-[var(--color-fg)]">联系方式</h2><p className="mt-1 text-sm text-[var(--color-fg-mid)]">只填写明确公开给参赛者的联系方式。</p></div>
        <div className="grid gap-3">{data.contacts.map((item, index) => <ContactEditor key={item.id} item={item} index={index} total={data.contacts.length} pending={pending} run={run} />)}</div>
        <div className="grid gap-3 border-t border-[var(--color-border)] pt-4 md:grid-cols-2"><Field label="标签" value={contact.label} onChange={(value) => setContact((current) => ({ ...current, label: value }))} /><Field label="公开名称" value={contact.publicName} onChange={(value) => setContact((current) => ({ ...current, publicName: value }))} /><Field label="联系方式" value={contact.value} onChange={(value) => setContact((current) => ({ ...current, value }))} /><Field label="链接（可选）" value={contact.href} onChange={(value) => setContact((current) => ({ ...current, href: value }))} /><div className="space-y-2 md:col-span-2"><Label>说明</Label><Textarea rows={2} value={contact.note} onChange={(event) => setContact((current) => ({ ...current, note: event.target.value }))} /></div><Button disabled={pending || !contact.label.trim() || !contact.value.trim()} onClick={() => run(async () => { const result = await createSeasonContact({ seasonId: data.season.id, ...contact }); if (result.success) setContact({ label: "", publicName: "", value: "", href: "", note: "" }); return result; }, "联系方式已创建")}>新增联系方式</Button></div>
      </section>
    </div>
  );
}

function GroupEditor({ item, index, total, pending, run }: { item: GroupRow; index: number; total: number; pending: boolean; run: (work: () => AsyncResult, message: string) => void }) {
  const [form, setForm] = useState({ label: item.label, audience: item.audience ?? "", groupNumber: item.groupNumber ?? "", joinUrl: item.joinUrl ?? "", note: item.note ?? "" });
  const save = () => run(() => updateCommunityGroup({ id: item.id, ...form, status: item.status }), "交流群已更新");
  return <div className="border border-[var(--color-border)] bg-[var(--color-panel)] p-4"><div className="grid gap-3 md:grid-cols-2"><Field label="名称" value={form.label} onChange={(value) => setForm((current) => ({ ...current, label: value }))} /><Field label="面向人群" value={form.audience} onChange={(value) => setForm((current) => ({ ...current, audience: value }))} /><Field label="群号" value={form.groupNumber} onChange={(value) => setForm((current) => ({ ...current, groupNumber: value }))} /><Field label="加入链接" value={form.joinUrl} onChange={(value) => setForm((current) => ({ ...current, joinUrl: value }))} /><div className="space-y-2 md:col-span-2"><Label>说明</Label><Textarea rows={2} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} /></div><div className="flex items-end gap-2 text-sm"><span className={item.status === "active" ? "text-[var(--color-ok)]" : "text-[var(--color-fg-dim)]"}>{item.status === "active" ? "启用中" : "已关闭"}</span>{item.qrImagePath && <span className="text-[var(--color-fg-dim)]">已有二维码</span>}</div></div><div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" disabled={pending || !form.label.trim() || (item.status === "active" && !form.groupNumber.trim() && !form.joinUrl.trim() && !item.qrImagePath)} onClick={save}>保存</Button><Button size="sm" variant="outline" disabled={pending || index === 0} onClick={() => run(() => moveCommunityGroup(item.id, "up"), "已上移")}>上移</Button><Button size="sm" variant="outline" disabled={pending || index === total - 1} onClick={() => run(() => moveCommunityGroup(item.id, "down"), "已下移")}>下移</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => updateCommunityGroup({ id: item.id, ...form, status: item.status === "active" ? "closed" : "active" }), item.status === "active" ? "交流群已关闭" : "交流群已启用")}>{item.status === "active" ? "关闭交流群" : "重新启用"}</Button>{item.qrImagePath && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => removeCommunityGroupQr(item.id), "二维码已删除")}>删除二维码</Button>}<Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => deleteCommunityGroup(item.id), "交流群已删除")}>删除</Button><label className="inline-flex h-9 cursor-pointer items-center border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-panel-hi)]">上传/更换二维码<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (!file) return; if (file.size > LOGO_MAX_BYTES) { toast.error("二维码图片不能超过 1 MB。 "); return; } if (!(LOGO_ALLOWED_TYPES as readonly string[]).includes(file.type)) { toast.error("请上传 JPG、PNG 或 WebP 格式的图片。 "); return; } const formData = new FormData(); formData.set("file", file); run(() => uploadCommunityGroupQr(item.id, formData), "二维码已更新"); }} /></label></div></div>;
}

function ContactEditor({ item, index, total, pending, run }: { item: ContactRow; index: number; total: number; pending: boolean; run: (work: () => AsyncResult, message: string) => void }) {
  const [form, setForm] = useState({ label: item.label, publicName: item.publicName ?? "", value: item.value, href: item.href ?? "", note: item.note ?? "" });
  return <div className="border border-[var(--color-border)] bg-[var(--color-panel)] p-4"><div className="grid gap-3 md:grid-cols-2"><Field label="标签" value={form.label} onChange={(value) => setForm((current) => ({ ...current, label: value }))} /><Field label="公开名称" value={form.publicName} onChange={(value) => setForm((current) => ({ ...current, publicName: value }))} /><Field label="联系方式" value={form.value} onChange={(value) => setForm((current) => ({ ...current, value }))} /><Field label="链接（可选）" value={form.href} onChange={(value) => setForm((current) => ({ ...current, href: value }))} /><div className="space-y-2 md:col-span-2"><Label>说明</Label><Textarea rows={2} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} /></div></div><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={pending || !form.label.trim() || !form.value.trim()} onClick={() => run(() => updateSeasonContact({ id: item.id, ...form }), "联系方式已更新")}>保存</Button><Button size="sm" variant="outline" disabled={pending || index === 0} onClick={() => run(() => moveSeasonContact(item.id, "up"), "已上移")}>上移</Button><Button size="sm" variant="outline" disabled={pending || index === total - 1} onClick={() => run(() => moveSeasonContact(item.id, "down"), "已下移")}>下移</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => deleteSeasonContact(item.id), "联系方式已删除")}>删除</Button></div></div>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label>{label}</Label><Input value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}
