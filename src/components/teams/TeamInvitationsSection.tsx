"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/rivalhub";
import { formatCST } from "@/lib/utils/date";

type Invitation = { id: string; teamId: string; teamName: string; email?: string | null; expiresAt: string };
type GeneratedShareLink = { url: string; expiresAt: string };

export function TeamInvitationsSection({ team, incoming, outgoing, isCaptain, pending, email, shareLink, onEmailChange, onAccept, onDecline, onInvite, onCreateShareLink, onRevoke }: {
  team: { id: string } | null;
  incoming: Invitation[];
  outgoing: Invitation[];
  isCaptain: boolean;
  pending: boolean;
  email: string;
  shareLink: GeneratedShareLink | null;
  onEmailChange: (value: string) => void;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  onInvite: () => void;
  onCreateShareLink: () => void;
  onRevoke: (id: string) => void;
}) {
  return <>{incoming.length > 0 && <div id="team-invitations" className="scroll-mt-24"><Panel label="待处理邀请" contentClassName="p-5"><div className="space-y-3"><p className="text-sm leading-6 text-[var(--color-fg-mid)]">接受邀请即加入队伍，不需要再次申请或等待队长审核。</p>{incoming.map((invite) => <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3"><div><p className="font-medium">{invite.teamName}</p><p className="text-xs text-[var(--color-fg-mid)]">有效期至 {formatCST(invite.expiresAt)}</p></div><div className="flex gap-2"><Button type="button" disabled={pending} onClick={() => onAccept(invite.id)}>接受</Button><Button type="button" variant="outline" disabled={pending} onClick={() => onDecline(invite.id)}>拒绝</Button></div></div>)}</div></Panel></div>}{team && isCaptain && <Panel label="邀请成员" contentClassName="p-5"><div className="space-y-4"><div className="flex gap-2"><Input value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="已注册邮箱" /><Button type="button" disabled={pending || !email} onClick={onInvite}>直接邀请</Button></div><Button type="button" variant="outline" disabled={pending} onClick={onCreateShareLink}>生成单次邀请链接</Button>{shareLink && <div className="space-y-2"><p className="text-sm font-medium">单次邀请链接 · 7 天有效</p><p className="text-sm text-[var(--color-fg-mid)]">到期时间：{formatCST(shareLink.expiresAt)}。</p><p className="text-sm text-[var(--color-fg-mid)]">接受一次后失效；可由队长撤销。</p><Input aria-label="单次邀请链接" readOnly value={shareLink.url} onFocus={(event) => event.currentTarget.select()} /></div>}{outgoing.map((invite) => <div key={invite.id} className="flex items-center justify-between gap-3 text-sm"><span>{invite.email ?? "单次分享链接"} · 待处理 · 有效期至 {formatCST(invite.expiresAt)}</span><Button type="button" variant="outline" disabled={pending} onClick={() => onRevoke(invite.id)}>撤销</Button></div>)}</div></Panel>}</>;
}
