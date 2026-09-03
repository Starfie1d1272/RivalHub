"use client";

import React, { useState, useTransition } from "react";
import { toast } from "sonner";
import { createInviteCode, deactivateInviteCode } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatCSTShortDate } from "@/lib/utils/date";

interface InviteRow {
  id: string;
  code: string;
  role: "super_admin" | "season_admin";
  seasonId: string | null;
  maxUses: number;
  claimCount: number;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

interface SeasonOption {
  id: string;
  name: string;
  slug: string;
}

interface PendingSuperAdminInvite {
  maxUses: number;
  expiresInHours?: number;
}

type InviteCreateInput = Parameters<typeof createInviteCode>[0];

export function InviteManager({
  invites: initialInvites,
  seasons,
}: {
  invites: InviteRow[];
  seasons: SeasonOption[];
}) {
  const [invites, setInvites] = useState(initialInvites);
  const [role, setRole] = useState<"season_admin" | "super_admin">("season_admin");
  const [seasonId, setSeasonId] = useState(seasons[0]?.id ?? "");
  const [maxUses, setMaxUses] = useState(1);
  const [expiresInHours, setExpiresInHours] = useState("");
  const [pendingSuperAdminInvite, setPendingSuperAdminInvite] =
    useState<PendingSuperAdminInvite | null>(null);
  const [isPending, startTransition] = useTransition();
  const seasonNameById = new Map(seasons.map((season) => [season.id, season.name]));

  function submitInvite(input: InviteCreateInput) {
    startTransition(async () => {
      const result = await createInviteCode(input);
      if (!result.success) {
        toast.error(result.error.message);
      } else {
        toast.success(`邀请码已生成：${result.data.code}`);
        setInvites((prev) => [
          {
            id: result.data.id,
            code: result.data.code,
            role: result.data.role,
            seasonId: result.data.seasonId,
            maxUses: result.data.maxUses,
            claimCount: 0,
            expiresAt: result.data.expiresAt,
            isActive: true,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
      }
    });
  }

  function handleCreate() {
    const input: InviteCreateInput = {
      role,
      seasonId: role === "season_admin" ? seasonId : undefined,
      maxUses: maxUses || 1,
      expiresInHours: expiresInHours ? Number(expiresInHours) : undefined,
    };

    if (role === "super_admin") {
      setPendingSuperAdminInvite({
        maxUses: input.maxUses ?? 1,
        expiresInHours: input.expiresInHours,
      });
      return;
    }

    submitInvite(input);
  }

  function handleConfirmSuperAdmin() {
    if (!pendingSuperAdminInvite) return;

    const invite = pendingSuperAdminInvite;
    setPendingSuperAdminInvite(null);
    submitInvite({
      role: "super_admin",
      maxUses: invite.maxUses,
      expiresInHours: invite.expiresInHours,
    });
  }

  function handleDeactivate(inviteId: string, code: string) {
    startTransition(async () => {
      const result = await deactivateInviteCode(inviteId);
      if (!result.success) {
        toast.error(result.error.message);
      } else {
        toast.success(`邀请码 ${code} 已失效`);
        setInvites((prev) =>
          prev.map((inv) =>
            inv.id === inviteId ? { ...inv, isActive: false } : inv,
          ),
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* 新建邀请码表单 */}
      <Card className="p-4">
        <h2 className="font-medium mb-3">新建邀请码</h2>
        <div className="flex gap-4 items-end flex-wrap">
          <div className="space-y-1">
            <Label htmlFor="inv-role">角色</Label>
            <select
              id="inv-role"
              className="h-9 rounded-sm border border-[var(--color-border)] bg-transparent px-3 text-sm"
              value={role}
              onChange={(e) =>
                setRole(e.target.value as "season_admin" | "super_admin")
              }
            >
              <option value="season_admin">赛季管理员</option>
              <option value="super_admin">超级管理员</option>
            </select>
          </div>
          {role === "season_admin" && (
            <div className="space-y-1 min-w-44">
              <Label htmlFor="inv-season">赛季范围</Label>
              <select
                id="inv-season"
                className="h-9 rounded-sm border border-[var(--color-border)] bg-transparent px-3 text-sm w-full"
                value={seasonId}
                onChange={(e) => setSeasonId(e.target.value)}
              >
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1 w-20">
            <Label htmlFor="inv-uses">次数</Label>
            <Input
              id="inv-uses"
              type="number"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1 w-32">
            <Label htmlFor="inv-expire">有效期（小时）</Label>
            <Input
              id="inv-expire"
              type="number"
              min={1}
              placeholder="留空则永久"
              value={expiresInHours}
              onChange={(e) => setExpiresInHours(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={isPending || (role === "season_admin" && !seasonId)}
          >
            生成邀请码
          </Button>
        </div>
        {role === "super_admin" && (
          <div
            role="alert"
            className="mt-4 rounded-sm border border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)] p-3 text-sm"
          >
            <p className="font-medium text-[var(--color-warn)]">
              高权限提示：超级管理员邀请码
            </p>
            <p className="mt-1 text-[var(--color-fg-mid)]">
              超级管理员拥有跨赛事管理、教育认证审核及全局管理能力。仅应发给确实需要全局权限的人员；日常赛务请使用“赛季管理员”。
            </p>
          </div>
        )}
      </Card>

      <AlertDialog
        open={pendingSuperAdminInvite !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSuperAdminInvite(null);
        }}
      >
        {pendingSuperAdminInvite && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认生成超级管理员邀请码？</AlertDialogTitle>
              <AlertDialogDescription>
                这不是某一赛事范围内的管理员邀请码，而是拥有跨赛事全局管理能力的超级管理员权限。请确认下面的设置。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <dl className="space-y-2 rounded-sm border border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)] p-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[var(--color-fg-mid)]">角色</dt>
                <dd className="font-medium">超级管理员</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[var(--color-fg-mid)]">权限范围</dt>
                <dd className="text-right font-medium">跨赛事全局（不绑定单一赛事）</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[var(--color-fg-mid)]">使用次数（maxUses）</dt>
                <dd className="font-medium">{pendingSuperAdminInvite.maxUses} 次</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[var(--color-fg-mid)]">有效期</dt>
                <dd className="text-right font-medium">
                  {pendingSuperAdminInvite.expiresInHours === undefined
                    ? "永久有效，直到撤销或用尽"
                    : `${pendingSuperAdminInvite.expiresInHours} 小时（从生成时起算）`}
                </dd>
              </div>
            </dl>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                disabled={isPending}
                onClick={handleConfirmSuperAdmin}
              >
                确认生成超级管理员邀请码
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      <Separator />

      {/* 邀请码列表 */}
      <h2 className="font-medium">历史邀请码</h2>
      {invites.length === 0 ? (
        <p className="text-sm text-[var(--color-fg-mid)]">暂无邀请码</p>
      ) : (
        <div className="space-y-2">
          {invites.map((inv) => (
            <Card
              key={inv.id || inv.code}
              className="p-3 flex items-center justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <code className="text-sm font-mono">{inv.code}</code>
                <div className="flex items-center gap-2 mt-1 text-xs text-[var(--color-fg-mid)]">
                  <Badge variant="outline" className="text-xs">
                    {inv.role === "super_admin" ? "超级管理员" : "赛季管理员"}
                  </Badge>
                  {inv.role === "season_admin" && inv.seasonId && (
                    <span>范围：{seasonNameById.get(inv.seasonId) ?? inv.seasonId}</span>
                  )}
                  <span>
                    使用 {inv.claimCount}/{inv.maxUses}
                  </span>
                  {inv.expiresAt && (
                    <span>
                      过期：{formatCSTShortDate(inv.expiresAt)}
                    </span>
                  )}
                  {!inv.isActive && (
                    <Badge
                      variant="outline"
                      className="text-xs bg-[var(--color-danger-soft)] text-[var(--color-danger)] border-[var(--color-danger-edge)]"
                    >
                      已失效
                    </Badge>
                  )}
                </div>
              </div>
              {inv.isActive && inv.claimCount < inv.maxUses && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => handleDeactivate(inv.id, inv.code)}
                >
                  撤销
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
