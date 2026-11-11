"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { revokeUserAdminRole as telemetry_revokeUserAdminRole } from "@/actions/admin";
import { getDisplayName } from "@/lib/identity/display-name";
import { formatCST } from "@/lib/utils/date";
import { Panel } from "@/components/rivalhub";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { observeAction } from "@/lib/telemetry/client";

const revokeUserAdminRole = observeAction(
  "admin.revokeUserAdminRole",
  telemetry_revokeUserAdminRole,
);

interface AdminUserRow {
  id: string;
  email: string;
  personaName: string | null;
  steam64: string | null;
  liveStreamUrl: string | null;
  displayName: string | null;
  perfectName: string | null;
  role: "super_admin" | "season_admin";
  seasonIds: string[];
  createdAt: string;
}

interface AdminUserListProps {
  users: AdminUserRow[];
  seasonMap: Record<string, string>;
  currentUserId: string;
}

export function AdminUserList({ users, seasonMap, currentUserId }: AdminUserListProps) {
  const [pending, startTransition] = useTransition();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const originRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const target = users.find((user) => user.id === targetId && user.id !== currentUserId);

  function handleRevoke(id: string) {
    setRevokeError(null);
    startTransition(async () => {
      try {
        const result = await revokeUserAdminRole(id);
        if (!result.success) {
          setRevokeError(result.error.message);
          return;
        }
        toast.success("已撤销管理员权限");
        setTargetId(null);
      } catch {
        setRevokeError("未能确认撤销结果，请返回名单刷新后核对。");
      }
    });
  }

  async function copyValue(label: string, value: string) {
    try {
      if (!navigator.clipboard) throw new Error("当前环境不支持复制");
      await navigator.clipboard.writeText(value);
      toast.success(`${label} 已复制`);
    } catch {
      toast.error(`无法复制 ${label}，请手动复制`);
    }
  }

  const list = (
    <Panel contentClassName="p-0" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
              <th className="px-4 py-3 text-left">管理员</th>
              <th className="px-4 py-3 text-left">邮箱</th>
              <th className="px-4 py-3 text-left">权限范围</th>
              <th className="px-4 py-3 text-left">Steam64</th>
              <th className="px-4 py-3 text-left">直播间</th>
              <th className="px-4 py-3 text-right">加入时间</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-[var(--color-surface-raised)] transition-colors">
                <td className="px-4 py-3 font-medium text-[var(--color-fg)]">
                  <span className="flex items-center gap-2">
                    {getDisplayName(u)}
                    {u.id === currentUserId && (
                      <span className="text-[10px] text-[var(--color-fg-dim)] border border-[var(--color-border)] rounded px-1 py-px">
                        你
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-fg-mid)]">{u.email}</td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <Badge
                      variant={u.role === "super_admin" ? "default" : "outline"}
                      className="text-[10px]"
                    >
                      {u.role === "super_admin" ? "超级管理员" : "赛季管理员"}
                    </Badge>
                    {u.role === "super_admin" && (
                      <span className="text-[10px] text-[var(--color-fg-dim)]">全局</span>
                    )}
                    {u.role === "season_admin" &&
                      u.seasonIds.map((sid) => {
                        const name = seasonMap[sid];
                        if (!name) return null;
                        return (
                          <span key={sid} className="text-[10px] text-[var(--color-fg-dim)]">
                            {name}
                          </span>
                        );
                      })}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {u.steam64 ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-[var(--color-fg-mid)]">
                        {u.steam64}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        onClick={() => void copyValue("Steam64", u.steam64!)}
                        aria-label="复制 Steam64"
                      >
                        复制
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--color-fg-dim)]">未填写 Steam64</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {u.liveStreamUrl ? (
                    <div className="flex items-center gap-2">
                      <a
                        href={u.liveStreamUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="max-w-56 truncate text-xs text-[var(--color-fg-mid)] underline underline-offset-2 hover:text-[var(--color-fg)]"
                      >
                        {u.liveStreamUrl}
                      </a>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        onClick={() => void copyValue("直播间", u.liveStreamUrl!)}
                        aria-label="复制直播间"
                      >
                        复制
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--color-fg-dim)]">未填写直播间</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-xs text-[var(--color-fg-dim)] tabular-nums">
                  {formatCST(u.createdAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  {u.id !== currentUserId && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      aria-haspopup="dialog"
                      onClick={(event) => {
                        originRef.current = event.currentTarget;
                        setRevokeError(null);
                        setTargetId(u.id);
                      }}
                      className="text-[var(--color-danger)] hover:text-[var(--color-danger)]"
                    >
                      撤销
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );

  return (
    <>
      <div ref={listRef} role="region" aria-label="管理员名单" tabIndex={-1}>
        {users.length > 0 ? (
          list
        ) : (
          <Panel contentClassName="p-8 text-center text-sm text-[var(--color-fg-mid)]">
            暂无管理员用户
          </Panel>
        )}
      </div>
      <AlertDialog
        open={target !== undefined}
        onOpenChange={(open) => {
          if (!open && !pending) setTargetId(null);
        }}
      >
        {target && (
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const origin = originRef.current;
              if (origin?.isConnected) origin.focus();
              else listRef.current?.focus();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>撤销全部管理员权限？</AlertDialogTitle>
              <AlertDialogDescription className="[overflow-wrap:anywhere]">
                将撤销 {getDisplayName(target)}（{target.email}
                ）的全部管理员权限。该账号将变为普通用户，原有 DAK 配对凭据同时失效。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 text-sm [overflow-wrap:anywhere]">
              {target.role === "super_admin" && <p>将撤销全局超级管理员权限。</p>}
              {target.seasonIds.length > 0 && (
                <div className="space-y-1">
                  <p className="font-medium">
                    将撤销全部赛事授权（当前 {target.seasonIds.length} 届）
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    {target.seasonIds.map((id) => (
                      <li key={id}>{seasonMap[id] ?? "未命名赛事"}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {revokeError && (
              <p role="alert" className="text-sm text-[var(--color-danger)]">
                {revokeError}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>返回管理员名单</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() => handleRevoke(target.id)}
              >
                {pending ? "正在撤销…" : "确认撤销全部权限"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </>
  );
}
