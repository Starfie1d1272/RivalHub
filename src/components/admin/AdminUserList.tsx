"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { revokeUserAdminRole } from "@/actions/admin";
import { getDisplayName } from "@/lib/utils/display-name";
import { formatCST } from "@/lib/utils/date";
import { Panel, Btn } from "@/components/rivalhub";
import { Badge } from "@/components/ui/badge";

interface AdminUserRow {
  id: string;
  email: string;
  steamName: string | null;
  displayName: string | null;
  perfectName: string | null;
  role: "super_admin" | "season_admin";
  adminSeasonIds: string[];
  createdAt: string;
}

interface AdminUserListProps {
  users: AdminUserRow[];
  seasonMap: Record<string, string>;
  currentUserId: string;
}

export function AdminUserList({ users, seasonMap, currentUserId }: AdminUserListProps) {
  const [, startTransition] = useTransition();
  const [localUsers, setLocalUsers] = useState(users);

  function handleRevoke(id: string) {
    startTransition(async () => {
      const result = await revokeUserAdminRole(id);
      if (!result.success) {
        toast.error(result.error.message);
      } else {
        toast.success("已撤销管理员权限");
        setLocalUsers((prev) => prev.filter((u) => u.id !== id));
      }
    });
  }

  if (localUsers.length === 0) {
    return (
      <Panel pad={32} className="text-center text-[var(--color-fg-mid)] text-sm">
        暂无管理员用户
      </Panel>
    );
  }

  return (
    <Panel pad={0} className="overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
            <th className="px-4 py-3 text-left">管理员</th>
            <th className="px-4 py-3 text-left">邮箱</th>
            <th className="px-4 py-3 text-left">权限范围</th>
            <th className="px-4 py-3 text-right">加入时间</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {localUsers.map((u) => (
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
                  <Badge variant={u.role === "super_admin" ? "default" : "outline"} className="text-[10px]">
                    {u.role === "super_admin" ? "超级管理员" : "赛季管理员"}
                  </Badge>
                  {u.role === "season_admin" &&
                    u.adminSeasonIds.map((sid) => {
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
              <td className="px-4 py-3 text-right text-xs text-[var(--color-fg-dim)] tabular-nums">
                {formatCST(u.createdAt)}
              </td>
              <td className="px-4 py-3 text-right">
                {u.id !== currentUserId && (
                  <Btn
                    small
                    ghost
                    onClick={() => handleRevoke(u.id)}
                    className="text-[var(--color-danger)] hover:text-[var(--color-danger)]"
                  >
                    撤销
                  </Btn>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
