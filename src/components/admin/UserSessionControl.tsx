"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { revokeUserSessions } from "@/actions/session-management";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function UserSessionControl({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(false);
  const [pending, startTransition] = useTransition();
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSettled(false); }}>
    <DialogTrigger asChild><Button size="sm" variant="ghost">退出旧登录</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>退出该用户的所有登录</DialogTitle></DialogHeader>
      <DialogDescription>所有现有登录都会失效，用户需要重新登录。此操作不会更改用户权限或密码。</DialogDescription>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={settled} onChange={(event) => setSettled(event.target.checked)} />
        <span>同时解除异常密码更新造成的登录暂停。我已确认密码更新请求结束，并核实密码状态或完成受控重置。</span>
      </label>
      <Button disabled={pending} onClick={() => startTransition(async () => {
        const result = await revokeUserSessions({ userId, providerMutationSettled: settled });
        if (!result.success) { toast.error(result.error.message); return; }
        toast.success("已退出该用户的所有登录");
        setOpen(false);
        setSettled(false);
      })}>{pending ? "处理中…" : "确认退出所有登录"}</Button>
    </DialogContent>
  </Dialog>;
}
