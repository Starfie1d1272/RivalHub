"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { revokeUserAdminRole } from "@/actions/admin";
import { formatCST } from "@/lib/utils/date";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface AdminUserRow {
  id: string;
  email: string;
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
      <p className="text-sm text-[var(--color-fg-mid)] py-4 text-center">
        暂无管理员用户
      </p>
    );
  }

  return (
    <div className="space-y-2 mt-4">
      {localUsers.map((u) => (
        <Card
          key={u.id}
          className="p-3 flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            <span className="font-medium text-sm truncate">
              {u.email}
              {u.id === currentUserId && (
                <span className="text-xs text-[var(--color-fg-mid)] ml-1">（你）</span>
              )}
            </span>
            <Badge variant={u.role === "super_admin" ? "default" : "outline"}>
              {u.role === "super_admin" ? "超级管理员" : "赛季管理员"}
            </Badge>
            {u.role === "season_admin" &&
              u.adminSeasonIds.map((sid) => {
                const name = seasonMap[sid];
                if (!name) return null;
                return (
                  <span
                    key={sid}
                    className="text-xs text-[var(--color-fg-dim)]"
                  >
                    {name}
                  </span>
                );
              })}
          </div>

          <div className="flex items-center gap-2 text-xs text-[var(--color-fg-mid)] shrink-0">
            <span>创建于 {formatCST(u.createdAt)}</span>
            {u.id !== currentUserId && (
              <>
                <Separator orientation="vertical" className="h-3" />
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs h-auto py-0 text-red-500 hover:text-red-600"
                  onClick={() => handleRevoke(u.id)}
                >
                  撤销权限
                </Button>
              </>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
