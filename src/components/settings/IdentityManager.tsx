"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { requestSecondaryEmailIdentity, revokeSecondaryEmailIdentity } from "@/actions/identity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, StatusBanner } from "@/components/rivalhub";

type Identity = { id: string; email: string; primary: boolean; verifiedAt: string };

export function IdentityManager({ identities }: { identities: Identity[] }) {
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();

  function requestLink() {
    startTransition(async () => {
      const result = await requestSecondaryEmailIdentity(email);
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setEmail("");
      toast.success("验证邮件已发送。完成验证后会绑定身份，或进入重复账号安全预检。");
    });
  }

  function revoke(identity: Identity) {
    startTransition(async () => {
      const result = await revokeSecondaryEmailIdentity(identity.id);
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success("备用邮箱已撤销；赛事历史与个人事实未改变。");
    });
  }

  return <div className="space-y-5">
    <Panel label="已验证的邮箱身份" contentClassName="p-0">
      <div className="divide-y divide-[var(--color-border)]">
        {identities.map((identity) => <div key={identity.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-medium">{identity.email}</p>
            <p className="mt-1 text-xs text-[var(--color-fg-mid)]">{identity.primary ? "当前登录邮箱" : "备用已验证邮箱"}</p>
          </div>
          {identity.primary
            ? <span className="text-[11px] text-[var(--color-fg-mid)]">当前登录邮箱</span>
            : <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => revoke(identity)}>撤销绑定</Button>}
        </div>)}
      </div>
    </Panel>
    <Panel label="添加备用邮箱" contentClassName="p-5">
      <div className="space-y-4">
        <StatusBanner tone="info" title="先证明邮箱控制权" sub="验证不会更换当前登录邮箱。若该邮箱已属于另一个账号，会先显示归并影响，确认前不会写入赛事事实。" />
        <div className="space-y-1.5">
          <Label htmlFor="secondary-email">邮箱</Label>
          <Input id="secondary-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@smail.nju.edu.cn" />
        </div>
        <Button type="button" disabled={pending || !email.trim()} onClick={requestLink}>{pending ? "发送中…" : "发送验证邮件"}</Button>
      </div>
    </Panel>
  </div>;
}
