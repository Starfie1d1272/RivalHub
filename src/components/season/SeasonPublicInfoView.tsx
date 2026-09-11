"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Panel } from "@/components/rivalhub";
import { isExternalPublicHref, type PublicSeasonInfo } from "@/lib/season-public-info/presentation";

export function SeasonPublicInfoView({ info }: { info: PublicSeasonInfo }) {
  const [qr, setQr] = useState<{ label: string; url: string } | null>(null);
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); toast.success("群号已复制"); } catch { toast.error("复制失败，请手动选择群号。 "); }
  }
  return <div className="space-y-6">
    <Panel label="赛事规则"><a href={info.rules.href} className="inline-flex items-center gap-2 text-sm text-[var(--color-accent)] underline-offset-4 hover:underline" target={isExternalPublicHref(info.rules.href) ? "_blank" : undefined} rel={isExternalPublicHref(info.rules.href) ? "noopener noreferrer" : undefined}>{info.rules.label}<ExternalLink className="size-4" /></a></Panel>
    <section className="space-y-3"><div><h2 className="text-xl font-semibold text-[var(--color-fg)]">交流群</h2><p className="mt-1 text-sm text-[var(--color-fg-mid)]">按面向人群选择合适的交流群。</p></div><div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">{info.groups.length === 0 ? <Panel><p className="text-sm text-[var(--color-fg-mid)]">暂未配置交流群。</p></Panel> : info.groups.map((group) => <Panel key={group.id} contentClassName="p-4"><div className="flex h-full flex-col gap-3"><div><h3 className="font-semibold text-[var(--color-fg)]">{group.label}</h3>{group.audience && <p className="mt-1 text-xs text-[var(--color-fg-dim)]">{group.audience}</p>}</div>{group.status === "closed" ? <p className="text-sm text-[var(--color-fg-dim)]">已关闭</p> : <><p className="min-h-5 text-sm text-[var(--color-fg-mid)]">{group.note ?? ""}</p><div className="mt-auto flex flex-wrap gap-2">{group.groupNumber && <Button size="sm" variant="outline" onClick={() => void copy(group.groupNumber!)}><Copy className="size-4" />复制群号</Button>}{group.joinUrl && <Button size="sm" variant="outline" asChild><a href={group.joinUrl} target={isExternalPublicHref(group.joinUrl) ? "_blank" : undefined} rel={isExternalPublicHref(group.joinUrl) ? "noopener noreferrer" : undefined}>加入群聊</a></Button>}{group.qrImageUrl && <Button size="sm" onClick={() => setQr({ label: group.label, url: group.qrImageUrl! })}>查看二维码</Button>}</div></>}</div></Panel>)}</div></section>
    <section className="space-y-3"><div><h2 className="text-xl font-semibold text-[var(--color-fg)]">联系方式</h2><p className="mt-1 text-sm text-[var(--color-fg-mid)]">仅显示赛事方明确公开的联系渠道。</p></div><div className="grid gap-3 md:grid-cols-2">{info.contacts.length === 0 ? <Panel><p className="text-sm text-[var(--color-fg-mid)]">暂未配置联系方式。</p></Panel> : info.contacts.map((contact) => <Panel key={contact.id} contentClassName="p-4"><p className="font-medium text-[var(--color-fg)]">{contact.label}{contact.publicName ? ` · ${contact.publicName}` : ""}</p><p className="mt-2 break-words text-sm text-[var(--color-fg-mid)]">{contact.href ? <a className="text-[var(--color-accent)] hover:underline" href={contact.href} target={isExternalPublicHref(contact.href) ? "_blank" : undefined} rel={isExternalPublicHref(contact.href) ? "noopener noreferrer" : undefined}>{contact.value}</a> : contact.value}</p>{contact.note && <p className="mt-2 text-xs text-[var(--color-fg-dim)]">{contact.note}</p>}</Panel>)}</div></section>
    <Dialog open={Boolean(qr)} onOpenChange={(open) => { if (!open) setQr(null); }}><DialogContent size="md"><DialogHeader><DialogTitle>{qr?.label ?? "交流群二维码"}</DialogTitle><DialogDescription>可以使用手机扫码，或长按图片保存。</DialogDescription></DialogHeader><DialogBody className="flex justify-center pb-6"><img src={qr?.url ?? ""} alt={`${qr?.label ?? "交流群"}二维码`} className="max-h-[min(65dvh,28rem)] w-auto max-w-full object-contain" /></DialogBody></DialogContent></Dialog>
  </div>;
}
