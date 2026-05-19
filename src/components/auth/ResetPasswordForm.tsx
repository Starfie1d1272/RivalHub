"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Field, Btn } from "@/components/rivalhub";
import { createBrowserClient } from "@/lib/auth/supabase";
import { MIN_PASSWORD_LENGTH } from "@/lib/config/auth-config";

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      toast.error(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
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
      <Field id="password" label="新密码" type="password" placeholder={`至少 ${MIN_PASSWORD_LENGTH} 位`} value={password} onChange={setPassword} required minLength={MIN_PASSWORD_LENGTH} />
      <Btn type="submit" full disabled={isPending}>{isPending ? "设置中…" : "设置新密码"}</Btn>
    </form>
  );
}
