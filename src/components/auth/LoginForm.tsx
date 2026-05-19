"use client";

import { useState, useTransition, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Field, Btn } from "@/components/rivalhub";
import { loginWithPassword, signUp } from "@/actions/auth";
import { TurnstileWidget } from "@/components/auth/TurnstileWidget";

type Mode = "login" | "register";

/** 校验重定向目标：只允许本站相对路径，防 open redirect */
function safeRedirect(raw: string | null): string {
  if (!raw) return "/";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const [mode, setMode] = useState<Mode>("login");
  const [isPending, startTransition] = useTransition();
  const redirectRef = useRef(safeRedirect(new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  ).get("next")));

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = mode === "login"
        ? await loginWithPassword(email, password)
        : await signUp(email, password, turnstileToken);
      if (result.success) {
        window.location.href = redirectRef.current;
      } else {
        toast.error(result.error.message);
      }
    });
  }, [email, password, mode, turnstileToken]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex rounded-lg bg-[var(--color-panel-low)] p-0.5">
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
            mode === "login"
              ? "bg-[var(--color-panel)] text-[var(--color-fg)] shadow-sm"
              : "text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
          }`}
        >
          登录
        </button>
        <button
          type="button"
          onClick={() => setMode("register")}
          className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
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
        placeholder={mode === "register" ? "至少 6 位" : "输入密码"}
        value={password}
        onChange={setPassword}
        required
        minLength={6}
      />

      {mode === "register" && (
        <div className="flex justify-center">
          <TurnstileWidget
            onVerify={(token) => setTurnstileToken(token)}
            onError={() => {
              setTurnstileToken("");
              toast.error("验证码加载失败，请刷新后重试");
            }}
          />
        </div>
      )}

      <Btn type="submit" full disabled={isPending || (mode === "register" && !turnstileToken)}>
        {isPending ? "处理中…" : mode === "login" ? "登录" : "注册"}
      </Btn>

      <p className="text-xs text-center text-[var(--color-fg-mid)]">
        {mode === "register" ? "已有账号？" : "首次参赛？"}
        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="ml-0.5 underline hover:text-[var(--color-fg)]"
        >
          {mode === "register" ? "切换到登录" : "切换到注册"}
        </button>
      </p>
    </form>
  );
}
