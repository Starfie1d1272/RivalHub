"use client";

import {
  resetUserPassword as telemetry_resetUserPassword,
  verifyPasswordRecovery,
  type PasswordRecoveryProof,
} from "@/actions/password-recovery";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Field } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { ErrorCode } from "@/lib/errors";
import {
  isPasswordPolicySatisfied,
  MIN_PASSWORD_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from "@/lib/config/auth-config";
import { useTelemetryTask } from "@/components/telemetry/TaskBoundary";
import { observeAction } from "@/lib/telemetry/client";
import type { ActionError } from "@/types/action";

const resetUserPassword = observeAction(
  "password-recovery.resetUserPassword",
  telemetry_resetUserPassword,
);

type RecoveryView =
  | { kind: "checking" }
  | { kind: "ready"; email: string }
  | { kind: "blocked"; message: string; next: "request" | "account" | "retry" | "support" };

function takeRecoveryProof(): PasswordRecoveryProof | null {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const token = url.searchParams.get("token");
  const accessToken = fragment.get("access_token");
  if (url.searchParams.has("token") || url.hash) {
    url.searchParams.delete("token");
    url.hash = "";
    window.history.replaceState(window.history.state, "", url.toString());
  }
  return token && accessToken && fragment.get("type") === "recovery" ? { token, accessToken } : null;
}

function verificationFailure(error: ActionError): RecoveryView {
  const { code, message } = error;
  if (code === ErrorCode.UNAUTHORIZED) return { kind: "blocked", message, next: "request" };
  if (code === ErrorCode.FORBIDDEN) return { kind: "blocked", message, next: "account" };
  if (code === ErrorCode.PASSWORD_UPDATE_OUTCOME_UNKNOWN)
    return { kind: "blocked", message, next: "support" };
  return {
    kind: "blocked",
    message: `暂时无法核验找回链接，请稍后重试。${error.requestId ? `排查编号：${error.requestId}` : ""}`,
    next: "retry",
  };
}

export function ResetPasswordForm() {
  const task = useTelemetryTask("account", "password-reset");
  const proofRef = useRef<PasswordRecoveryProof | null | undefined>(undefined);
  const [verification, setVerification] = useState<RecoveryView>({ kind: "checking" });
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isPending, startTransition] = useTransition();
  const [recoveryGuidance, setRecoveryGuidance] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (proofRef.current === undefined) proofRef.current = takeRecoveryProof();
    const proof = proofRef.current;
    let cancelled = false;
    async function checkLink() {
      try {
        const result = await (proof ? verifyPasswordRecovery(proof) : null);
        if (cancelled) return;
        if (!result) {
          setVerification({ kind: "blocked", message: "请从找回邮件打开有效链接，或重新请求邮件。", next: "request" });
        } else if (!result.success) {
          setVerification(verificationFailure(result.error));
        } else {
          setVerification({ kind: "ready", email: result.data.email });
        }
      } catch {
        if (!cancelled) {
          setVerification({ kind: "blocked", message: "暂时无法核验找回链接，请稍后重试。", next: "retry" });
        }
      }
    }
    void checkLink();
    return () => { cancelled = true; };
  }, [verificationAttempt]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const proof = proofRef.current;
    if (!proof || verification.kind !== "ready" || recoveryGuidance || isPending) return;
    const taskToken = task.begin("submit");
    if (!isPasswordPolicySatisfied(password)) {
      task.validation("password_policy", taskToken);
      toast.error(PASSWORD_POLICY_MESSAGE);
      return;
    }
    if (password !== confirmPassword) {
      task.validation("password_mismatch", taskToken);
      toast.error("两次输入的密码不一致");
      return;
    }
    startTransition(async () => {
      let committed = false;
      try {
        const result = await resetUserPassword(proof, password);
        if (!result.success) {
          if (result.error.code === ErrorCode.UNAUTHORIZED || result.error.code === ErrorCode.FORBIDDEN) {
            setVerification(verificationFailure(result.error));
          } else if (result.error.code === ErrorCode.VALIDATION_FAILED) {
            toast.error(result.error.message);
          } else {
            setRecoveryGuidance(result.error.message);
          }
        } else {
          task.complete(taskToken);
          committed = true;
          proofRef.current = null;
          toast.success("密码已重置，所有旧登录已退出，请用新密码登录");
          router.replace("/login");
          router.refresh();
        }
      } catch {
        setRecoveryGuidance(
          committed
            ? "密码已更新。请关闭此页面，再用新密码登录。"
            : "密码更新结果尚未确认。请停止提交，勿重复重置或尝试新旧密码；联系平台管理员核查账号服务与安全状态。",
        );
      }
    });
  };

  if (verification.kind === "checking") {
    return <p role="status" className="text-center text-sm text-[var(--color-fg-mid)]">正在核验找回链接…</p>;
  }

  if (verification.kind === "blocked") {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-sm leading-6 text-[var(--color-fg-mid)]">{verification.message}</p>
        {verification.next === "retry" ? (
          <Button type="button" size="lg" className="w-full" onClick={() => {
            setVerification({ kind: "checking" });
            setVerificationAttempt((attempt) => attempt + 1);
          }}>
            重新核验
          </Button>
        ) : verification.next !== "support" && (
          <Button asChild size="lg" className="w-full">
            <Link href={verification.next === "account" ? "/settings/security" : "/forgot-password"} prefetch={false}>
              {verification.next === "account" ? "查看当前账号" : "重新请求找回邮件"}
            </Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <form
      onInputCapture={() => task.begin()}
      onInvalidCapture={() => {
        task.begin();
        task.validation("form_invalid");
      }}
      onSubmit={handleSubmit}
      className="space-y-4"
    >
      <p role="status" className="break-all text-sm leading-6 text-[var(--color-fg-mid)]">
        正在为 <strong className="text-[var(--color-fg)]">{verification.email}</strong> 设置新密码。
      </p>
      <Field
        id="password"
        label="新密码"
        type="password"
        placeholder={`至少 ${MIN_PASSWORD_LENGTH} 位，含大小写/数字/特殊字符`}
        value={password}
        onChange={setPassword}
        required
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
      />
      <Field
        id="confirm-password"
        label="确认新密码"
        type="password"
        placeholder="再次输入密码"
        value={confirmPassword}
        onChange={setConfirmPassword}
        required
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
      />
      <p className="text-xs text-[var(--color-fg-mid)]">{PASSWORD_POLICY_MESSAGE}。</p>
      {recoveryGuidance && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {recoveryGuidance}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={isPending || recoveryGuidance !== null}>
        {isPending ? "设置中…" : "设置新密码"}
      </Button>
    </form>
  );
}
