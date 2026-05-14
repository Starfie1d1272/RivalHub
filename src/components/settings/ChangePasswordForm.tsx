"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { changeUserPassword } from "@/actions/account";
import { Field, Btn } from "@/components/rivalhub";
import { MIN_PASSWORD_LENGTH } from "@/lib/config/auth-config";

export function ChangePasswordForm() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }

    startTransition(async () => {
      const result = await changeUserPassword(oldPassword, newPassword);
      if (result.success) {
        toast.success("密码已更新");
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field
        id="old-password"
        label="原密码"
        type="password"
        placeholder="输入当前密码"
        value={oldPassword}
        onChange={setOldPassword}
        required
      />
      <Field
        id="new-password"
        label="新密码"
        type="password"
        placeholder={`至少 ${MIN_PASSWORD_LENGTH} 位`}
        value={newPassword}
        onChange={setNewPassword}
        required
        minLength={MIN_PASSWORD_LENGTH}
      />
      <Field
        id="confirm-password"
        label="确认新密码"
        type="password"
        placeholder="再次输入新密码"
        value={confirmPassword}
        onChange={setConfirmPassword}
        required
        minLength={MIN_PASSWORD_LENGTH}
      />
      <Btn type="submit" full disabled={isPending}>
        {isPending ? "更新中…" : "更新密码"}
      </Btn>
    </form>
  );
}
