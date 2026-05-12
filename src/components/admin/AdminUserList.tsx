"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deactivateAdminUser, reactivateAdminUser } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface AdminUserRow {
  id: string;
  username: string;
  role: "super_admin" | "admin";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function AdminUserList({ users, currentAdminId }: { users: AdminUserRow[]; currentAdminId?: string }) {
  const [, startTransition] = useTransition();
  const [localUsers, setLocalUsers] = useState(users);

  function handleDeactivate(id: string, username: string) {
    startTransition(async () => {
      const result = await deactivateAdminUser(id);
      if (!result.success) {
        toast.error(result.error.message);
      } else {
        toast.success(`${username} 已停用`);
        setLocalUsers((prev) =>
          prev.map((u) => (u.id === id ? { ...u, isActive: false } : u)),
        );
      }
    });
  }

  function handleReactivate(id: string, username: string) {
    startTransition(async () => {
      const result = await reactivateAdminUser(id);
      if (!result.success) {
        toast.error(result.error.message);
      } else {
        toast.success(`${username} 已重新启用`);
        setLocalUsers((prev) =>
          prev.map((u) => (u.id === id ? { ...u, isActive: true } : u)),
        );
      }
    });
  }

  return (
    <div className="space-y-2">
      {localUsers.map((u) => (
        <Card
          key={u.id}
          className={`p-3 flex items-center justify-between gap-4 ${
            !u.isActive ? "opacity-60" : ""
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-medium">
              {u.username}
              {u.id === currentAdminId && (
                <span className="text-xs text-[var(--color-fg-mid)] ml-1">（你）</span>
              )}
            </span>
            <Badge variant={u.role === "super_admin" ? "default" : "outline"}>
              {u.role === "super_admin" ? "超级管理员" : "管理员"}
            </Badge>
            {!u.isActive && (
              <Badge
                variant="outline"
                className="bg-red-500/10 text-red-600 border-red-500/20"
              >
                已停用
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-[var(--color-fg-mid)]">
            <span>
              创建于 {new Date(u.createdAt).toLocaleDateString("zh-CN")}
            </span>

            {u.username !== "RivalHub_root" && u.id !== currentAdminId && (
              <>
                <Separator orientation="vertical" className="h-3" />
                {u.isActive ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-auto py-0"
                    onClick={() => handleDeactivate(u.id, u.username)}
                  >
                    停用
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-auto py-0"
                    onClick={() => handleReactivate(u.id, u.username)}
                  >
                    重新启用
                  </Button>
                )}
              </>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
