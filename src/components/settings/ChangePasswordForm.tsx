"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { changeUserPassword as telemetry_changeUserPassword } from "@/actions/account";
import { Field } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { MIN_PASSWORD_LENGTH } from "@/lib/config/auth-config";
import { useTelemetryTask } from "@/components/telemetry/TaskBoundary";
import { observeAction } from "@/lib/telemetry/client";

const changeUserPassword = observeAction("account.changeUserPassword", telemetry_changeUserPassword);

export function ChangePasswordForm() {
  const task = useTelemetryTask("account", "password-change");
  const router = useRouter();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isPending, startTransition] = useTransition();
  const [recoveryGuidance, setRecoveryGuidance] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const taskToken = task.begin("submit");

    if (newPassword !== confirmPassword) {
      task.validation("password_mismatch", taskToken);
      toast.error("两次输入的新密码不一致");
      return;
    }

    startTransition(async () => {
      let committed = false;
      try {
      const result = await changeUserPassword(oldPassword, newPassword);
      if (result.success) {
        task.complete(taskToken);
        committed = true;
        toast.success("密码已更新，所有旧登录已退出，请重新登录");
        router.replace("/login");
        router.refresh();
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        if (result.error.code === "PASSWORD_UPDATE_OUTCOME_UNKNOWN") setRecoveryGuidance(result.error.message);
        toast.error(result.error.message);
      }
      } catch {
        setRecoveryGuidance(committed
          ? "密码更新已确认，导航未完成。请停止提交；如登录受阻，请联系平台管理员。"
          : "密码更新结果尚未确认。请停止提交，勿重复更新或尝试新旧密码；联系平台管理员核查账号服务与安全状态。");
      }
    });
  }

  return (
    <form onInputCapture={() => task.begin()} onInvalidCapture={() => { task.begin(); task.validation("form_invalid"); }} onSubmit={handleSubmit} className="space-y-4">
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
      {recoveryGuidance && <p role="alert" className="text-sm text-[var(--color-danger)]">{recoveryGuidance}</p>}
      <Button type="submit" variant="outline" className="w-full" disabled={isPending || recoveryGuidance !== null}>
        {isPending ? "更新中…" : "更新密码"}
      </Button>
    </form>
  );
}
