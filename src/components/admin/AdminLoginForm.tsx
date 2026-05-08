"use client";

import { useState, useTransition } from "react";
import { adminLogin } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AdminLoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!username.trim() || !password) {
      setError("请输入用户名和密码");
      return;
    }

    startTransition(async () => {
      try {
        const result = await adminLogin(username, password);
        // adminLogin redirects on success, so we only get here on failure
        if (!result) {
          setError("服务器未响应，请刷新页面后重试");
          return;
        }
        if (!result.success) {
          setError(result.error.message);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "登录失败，请稍后重试");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="username">用户名</Label>
        <Input
          id="username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="请输入管理员用户名"
          required
          autoFocus
          autoComplete="username"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">密码</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="请输入密码"
          required
          autoComplete="current-password"
        />
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "登录中..." : "登录"}
      </Button>
    </form>
  );
}
