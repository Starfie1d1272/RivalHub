"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Field } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { createBrowserClient } from "@/lib/auth/supabase";
import { isPasswordPolicySatisfied, MIN_PASSWORD_LENGTH, PASSWORD_POLICY_MESSAGE } from "@/lib/config/auth-config";

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPasswordPolicySatisfied(password)) {
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    if (password !== confirmPassword) {
      toast.error("两次输入的密码不一致");
      return;
    }
    startTransition(async () => {
      const supabase = createBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error("密码重置失败，链接可能已过期，请重新请求重置链接");
      } else {
        toast.success("密码已重置，请用新密码登录");
        router.push("/login");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field id="password" label="新密码" type="password" placeholder={`至少 ${MIN_PASSWORD_LENGTH} 位，含大小写/数字/特殊字符`} value={password} onChange={setPassword} required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
      <Field id="confirm-password" label="确认新密码" type="password" placeholder="再次输入密码" value={confirmPassword} onChange={setConfirmPassword} required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
      <p className="text-xs text-[var(--color-fg-mid)]">{PASSWORD_POLICY_MESSAGE}。</p>
      <Button type="submit" className="w-full" disabled={isPending}>{isPending ? "设置中…" : "设置新密码"}</Button>
    </form>
  );
}
