"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { createCoverageSlot, removeCoverageSlot, generateMizarPairing, disconnectMizar, uploadSeasonLogo } from "@/actions/matches/operations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/rivalhub";

type Slot = { id: string; startsAt: string; endsAt: string; capacity: number; note: string | null; occupied: number };
type Device = { id: string; displayName: string; lastSeenAt: string | null };

export function MatchOperationsTools({ seasonId, slots, devices, logoUrl }: { seasonId: string; slots: Slot[]; devices: Device[]; logoUrl: string | null }) {
  const router = useRouter();
  const [pending, transition] = useTransition();
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [capacity, setCapacity] = useState(1);
  const [note, setNote] = useState("");
  const submitSlot = () => transition(async () => {
    const result = await createCoverageSlot(seasonId, { startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), capacity, note });
    if (!result.success) { toast.error(result.error.message); return; }
    toast.success("已添加转播时段"); setStartsAt(""); setEndsAt(""); setNote(""); router.refresh();
  });
  return <div className="grid min-w-0 gap-4 lg:grid-cols-2">
    <Panel label="官方转播时段" contentClassName="space-y-4 p-4">
      <p className="text-xs text-[var(--color-fg-mid)]">时段只管理可选转播名额；队伍仍可自由约定比赛时间。</p>
      {slots.length ? <ul className="space-y-2">{slots.map(slot => <li key={slot.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--color-border)] p-2 text-sm">
        <span>{new Date(slot.startsAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} – {new Date(slot.endsAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" })} · {slot.occupied}/{slot.capacity}{slot.note ? ` · ${slot.note}` : ""}</span>
        <Button size="sm" variant="outline" disabled={pending || slot.occupied > 0} onClick={() => transition(async () => { const result = await removeCoverageSlot(seasonId, slot.id); if (!result.success) toast.error(result.error.message); else router.refresh(); })}>删除</Button>
      </li>)}</ul> : <p className="text-sm text-[var(--color-fg-mid)]">暂无转播时段</p>}
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); if (startsAt && endsAt) submitSlot(); }}>
        <label className="text-xs">开始时间<Input type="datetime-local" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label>
        <label className="text-xs">结束时间<Input type="datetime-local" required value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label>
        <label className="text-xs">容量<Input type="number" min={1} max={20} value={capacity} onChange={event => setCapacity(Number(event.target.value))} /></label>
        <label className="text-xs">备注<Input maxLength={300} value={note} onChange={event => setNote(event.target.value)} /></label>
        <Button type="submit" disabled={pending}>添加时段</Button>
      </form>
    </Panel>
    <div className="space-y-4">
      <Panel label="制播设备" contentClassName="space-y-3 p-4">
        <p className="text-xs text-[var(--color-fg-mid)]">在 Mizar 的“连接 RivalHub”中输入一次性连接码；连接后可浏览本届比赛。</p>
        <Button disabled={pending} onClick={() => transition(async () => { const result = await generateMizarPairing(seasonId); if (!result.success) toast.error(result.error.message); else setPairing(result.data); })}>生成连接码</Button>
        {pairing && <p role="status" className="rounded border border-[var(--color-accent)] p-3 font-mono text-lg tracking-wider">{pairing.code}<span className="block font-sans text-xs tracking-normal text-[var(--color-fg-mid)]">15 分钟内有效，仅显示一次</span></p>}
        {devices.length ? <ul className="space-y-2">{devices.map(device => <li key={device.id} className="flex items-center justify-between gap-2 text-sm"><span>{device.displayName}{device.lastSeenAt ? ` · 最近连接 ${new Date(device.lastSeenAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}` : ""}</span><Button size="sm" variant="outline" disabled={pending} onClick={() => transition(async () => { const result = await disconnectMizar(seasonId, device.id); if (!result.success) toast.error(result.error.message); else router.refresh(); })}>撤销</Button></li>)}</ul> : <p className="text-sm text-[var(--color-fg-mid)]">尚无已连接设备</p>}
      </Panel>
      <Panel label="赛事 Logo" contentClassName="space-y-3 p-4">
        {logoUrl && <p className="text-xs text-[var(--color-fg-mid)]">当前已设置赛事 Logo</p>}
        <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); transition(async () => { const result = await uploadSeasonLogo(seasonId, data); if (!result.success) toast.error(result.error.message); else { toast.success("Logo 已更新"); router.refresh(); } }); }} className="flex flex-wrap items-end gap-2">
          <label className="text-xs">上传图片<Input name="file" type="file" accept="image/png,image/jpeg,image/webp" required /></label>
          <Button type="submit" disabled={pending}>保存 Logo</Button>
        </form>
      </Panel>
    </div>
  </div>;
}
