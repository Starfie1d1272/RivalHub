"use client";

import { useState, useTransition, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginWithPassword, signUp } from "@/actions/auth";

type Mode = "login" | "register";

/** 校验重定向目标：只允许本站相对路径，防 open redirect */
function safeRedirect(raw: string | null): string {
  if (!raw) return "/";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("login");
  const [isPending, startTransition] = useTransition();
  const redirectRef = useRef(safeRedirect(new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  ).get("next")));

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const action = mode === "login" ? loginWithPassword : signUp;
      const result = await action(email, password);
      if (result.success) {
        window.location.href = redirectRef.current;
      } else {
        toast.error(result.error.message);
      }
    });
  }, [email, password, mode]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex rounded-lg bg-[var(--bg-secondary)] p-0.5">
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
            mode === "login"
              ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          登录
        </button>
        <button
          type="button"
          onClick={() => setMode("register")}
          className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
            mode === "register"
              ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          注册
        </button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">邮箱地址</Label>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">密码</Label>
        <Input
          id="password"
          type="password"
          placeholder={mode === "register" ? "至少 6 位" : "输入密码"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
      </div>

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "处理中…" : mode === "login" ? "登录" : "注册"}
      </Button>

      <p className="text-xs text-center text-[var(--text-secondary)]">
        {mode === "register" ? "已有账号？" : "首次参赛？"}
        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="ml-0.5 underline hover:text-[var(--text-primary)]"
        >
          {mode === "register" ? "切换到登录" : "切换到注册"}
        </button>
      </p>
    </form>
  );
}
