"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { loginWithPassword, signUp } from "@/actions/auth";

type Mode = "login" | "register";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("login");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const action = mode === "login" ? loginWithPassword : signUp;
      const result = await action(email, password);
      if (result.success) {
        window.location.href = window.location.search.includes("next=")
          ? new URLSearchParams(window.location.search).get("next") ?? "/"
          : "/";
      } else {
        toast.error(result.error.message);
      }
    });
  }

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
        {mode === "register"
          ? "已有账号？切换到登录"
          : "首次参赛？切换到注册创建账号"}
      </p>
    </form>
  );
}
