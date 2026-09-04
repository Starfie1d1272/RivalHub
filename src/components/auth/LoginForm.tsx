"use client";

import { useState, useTransition, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Field } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { loginWithPassword, resendSignupConfirmation, signUp } from "@/actions/auth";
import { TurnstileWidget } from "@/components/auth/TurnstileWidget";
import { EMAIL_RESEND_COOLDOWN_SECONDS, isPasswordPolicySatisfied, MIN_PASSWORD_LENGTH, PASSWORD_POLICY_MESSAGE } from "@/lib/config/auth-config";
import { safeLocalRedirect } from "@/lib/auth/redirect";

type Mode = "login" | "register";

export function LoginForm({ initialMode = "login", redirectTo = "/" }: { initialMode?: Mode; redirectTo?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [awaitingEmail, setAwaitingEmail] = useState<string | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const redirectRef = useRef(safeLocalRedirect(redirectTo));

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode);
    setConfirmPassword("");
    setTurnstileToken("");
    setTurnstileResetKey((key) => key + 1);
  };

  useEffect(() => {
    if (resendAvailableAt === null) return;
    const timeout = window.setTimeout(
      () => setResendAvailableAt(null),
      Math.max(0, resendAvailableAt - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [resendAvailableAt]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "register") {
      if (!isPasswordPolicySatisfied(password)) {
        toast.error(PASSWORD_POLICY_MESSAGE);
        return;
      }
      if (password !== confirmPassword) {
        toast.error("两次输入的密码不一致");
        return;
      }
    }
    startTransition(async () => {
      const result = mode === "login"
        ? await loginWithPassword(email, password)
        : await signUp(email, password, confirmPassword, turnstileToken, redirectRef.current);
      if (result.success) {
        if (mode === "register") {
          setAwaitingEmail(email.trim());
          setResendAvailableAt(Date.now() + EMAIL_RESEND_COOLDOWN_SECONDS * 1_000);
        } else {
          window.location.href = redirectRef.current;
        }
      } else {
        if (mode === "login" && result.error.code === "EMAIL_NOT_CONFIRMED") {
          setAwaitingEmail(email.trim());
          return;
        }
        if (mode === "register") {
          setTurnstileToken("");
          setTurnstileResetKey((key) => key + 1);
        }
        toast.error(result.error.message);
      }
    });
  }, [email, password, confirmPassword, mode, turnstileToken]);

  if (awaitingEmail) {
    const isResendCoolingDown = resendAvailableAt !== null;
    return (
      <div className="space-y-4">
        <div className="rounded-sm border border-[var(--color-border)] p-4">
          <h2 className="font-semibold">继续完成账号设置</h2>
          <p className="mt-2 break-all text-sm text-[var(--color-fg-mid)]">请检查邮箱：{awaitingEmail}</p>
          <p className="mt-2 text-sm text-[var(--color-fg-mid)]">如果这是你首次使用该邮箱注册，请前往邮箱完成验证。</p>
          <p className="mt-2 text-sm text-[var(--color-fg-mid)]">如果你此前已经使用这个邮箱注册过 RivalHub，请直接登录；忘记密码可以重新设置。</p>
          <p className="mt-2 text-sm text-[var(--color-fg-mid)]">为保护账号隐私，我们不会在这里确认该邮箱是否已注册。</p>
          <p className="mt-2 text-sm text-[var(--color-fg-mid)]">如果收件箱中没有看到邮件，请检查垃圾邮件、广告邮件或其它分类。</p>
        </div>
        <div className="space-y-2">
          <Button type="button" variant="outline" className="w-full" onClick={() => { setAwaitingEmail(null); setResendAvailableAt(null); setMode("login"); }}>
            去登录
          </Button>
          <Link href="/forgot-password" className="block w-full text-center text-sm underline hover:text-[var(--color-fg)]">
            找回密码
          </Link>
          <Button type="button" variant="outline" className="w-full" disabled={isPending || isResendCoolingDown} onClick={() => startTransition(async () => {
            const result = await resendSignupConfirmation(awaitingEmail, redirectRef.current);
            if (result.success) {
              setResendAvailableAt(Date.now() + EMAIL_RESEND_COOLDOWN_SECONDS * 1_000);
              toast.success("已提交验证邮件重发请求；如果该邮箱仍待验证，请检查收件箱及垃圾邮件等分类。");
            } else {
              toast.error(result.error.message);
            }
          })}>
            {isResendCoolingDown ? `请等待 ${EMAIL_RESEND_COOLDOWN_SECONDS} 秒后重试` : "重新发送验证邮件"}
          </Button>
        </div>
        <button type="button" className="w-full text-sm underline" onClick={() => { setAwaitingEmail(null); setResendAvailableAt(null); setMode("register"); setEmail(""); setPassword(""); setConfirmPassword(""); setTurnstileToken(""); setTurnstileResetKey((key) => key + 1); }}>
          使用其他邮箱
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex rounded-sm bg-[var(--color-panel-low)] p-0.5">
        <button
          type="button"
          onClick={() => switchMode("login")}
          className={`flex-1 rounded-sm py-1.5 text-sm font-medium transition-colors ${
            mode === "login"
              ? "bg-[var(--color-panel)] text-[var(--color-fg)] shadow-sm"
              : "text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
          }`}
        >
          登录
        </button>
        <button
          type="button"
          onClick={() => switchMode("register")}
          className={`flex-1 rounded-sm py-1.5 text-sm font-medium transition-colors ${
            mode === "register"
              ? "bg-[var(--color-panel)] text-[var(--color-fg)] shadow-sm"
              : "text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
          }`}
        >
          注册
        </button>
      </div>

      <Field
        id="email"
        label="邮箱地址"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={setEmail}
        required
        autoFocus
      />

      <Field
        id="password"
        label="密码"
        type="password"
        placeholder={mode === "register" ? "至少 6 位，含大小写/数字/特殊字符" : "输入密码"}
        value={password}
        onChange={setPassword}
        required
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete={mode === "register" ? "new-password" : "current-password"}
      />

      {mode === "register" && (
        <>
          <Field
            id="confirm-password"
            label="确认密码"
            type="password"
            placeholder="再次输入密码"
            value={confirmPassword}
            onChange={setConfirmPassword}
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
          />
          <p className="text-xs text-[var(--color-fg-mid)]">{PASSWORD_POLICY_MESSAGE}。</p>
        </>
      )}

      {mode === "register" && (
        <div className="flex justify-center">
          <TurnstileWidget
            resetSignal={turnstileResetKey}
            onVerify={(token) => setTurnstileToken(token)}
            onError={() => {
              setTurnstileToken("");
              toast.error("验证码加载失败，请刷新后重试");
            }}
          />
        </div>
      )}

      {mode === "register" && <p className="text-xs text-[var(--color-fg-mid)]">注册后需要验证邮箱才能完成注册和登录。</p>}

      <Button type="submit" variant="outline" className="w-full" disabled={isPending || (mode === "register" && !turnstileToken)}>
        {isPending ? "处理中…" : mode === "login" ? "登录" : "注册"}
      </Button>

      <p className="text-xs text-center text-[var(--color-fg-mid)]">
        {mode === "register" ? "已有账号？" : "首次参赛？"}
        <button
          type="button"
          onClick={() => switchMode(mode === "login" ? "register" : "login")}
          className="ml-0.5 underline hover:text-[var(--color-fg)]"
        >
          {mode === "register" ? "切换到登录" : "切换到注册"}
        </button>
      </p>
    </form>
  );
}
