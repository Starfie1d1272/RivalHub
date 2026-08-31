"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { sendPasswordResetEmail } from "@/actions/auth";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await sendPasswordResetEmail(email);
      if (result.success) {
        setSent(true);
      } else {
        toast.error(result.error.message);
      }
    });
  };

  if (sent) {
    return (
      <div className="text-center">
        <p className="text-sm text-[var(--color-fg)] mb-2">重置链接已发送</p>
        <p className="text-xs text-[var(--color-fg-mid)]">
          请查看邮箱 {email}，点击邮件中的链接设置新密码。链接 1 小时内有效。
        </p>
        <p className="mt-2 text-xs text-[var(--color-fg-mid)]">
          如果几分钟内没有收到，请检查垃圾邮件或稍后重新请求。
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field id="email" label="邮箱地址" type="email" placeholder="you@example.com" value={email} onChange={setEmail} required autoFocus />
      <Button type="submit" className="w-full" disabled={isPending}>{isPending ? "发送中…" : "发送重置链接"}</Button>
    </form>
  );
}
