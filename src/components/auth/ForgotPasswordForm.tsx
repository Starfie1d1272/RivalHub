"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { sendPasswordResetEmail as telemetry_sendPasswordResetEmail } from "@/actions/auth";
import { observeAction } from "@/lib/telemetry/client";

const sendPasswordResetEmail = observeAction("auth.sendPasswordResetEmail", telemetry_sendPasswordResetEmail);

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submittedEmail = email;
    startTransition(async () => {
      try {
      const result = await sendPasswordResetEmail(submittedEmail);
      if (result.success) {
        setSentEmail(submittedEmail);
      } else {
        toast.error(result.error.message);
      }
      } catch { setGuidance("发送请求结果尚未确认，请先检查收件箱和垃圾邮件；不要立即重复发送。"); }
    });
  };

  if (sentEmail !== null) {
    return (
      <div className="text-center">
        <p className="text-sm text-[var(--color-fg)] mb-2">重置链接已发送</p>
        <p className="text-xs text-[var(--color-fg-mid)]">
          请查看邮箱 {sentEmail}，点击邮件中的链接设置新密码。链接 1 小时内有效。
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
      {guidance && <p role="alert" className="text-sm text-[var(--color-danger)]">{guidance}</p>}
      <Button type="submit" className="w-full" disabled={isPending}>{isPending ? "发送中…" : "发送重置链接"}</Button>
    </form>
  );
}
