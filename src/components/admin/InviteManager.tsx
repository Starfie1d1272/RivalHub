"use client";

import React, { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import {
  ClearFilters,
  ListToolbar,
  PaginationControls,
  ResultSummary,
  useListQueryParams,
} from "@/components/rivalhub";
import {
  ADMIN_INVITE_DEFAULTS,
  type AdminInviteHistoryResult,
  type AdminInviteRoleFilter,
  type AdminInviteSeasonOption,
  type AdminInviteSort,
  type AdminInviteState,
} from "@/lib/admin/invites-contract";

interface PendingSuperAdminInvite {
  maxUses: number;
  expiresInHours?: number;
}

const INVITE_STATE_LABELS: Record<Exclude<AdminInviteState, "all">, string> = {
  usable: "可用",
  expired: "已过期",
  revoked: "已撤销",
  exhausted: "已用尽",
};

type InviteCreateInput = Parameters<typeof createInviteCode>[0];

export function InviteManager({
  history,
  seasons,
}: {
  history: AdminInviteHistoryResult;
  seasons: AdminInviteSeasonOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { update } = useListQueryParams({ routeBase: "/admin/invites", defaults: ADMIN_INVITE_DEFAULTS });
  const [role, setRole] = useState<"season_admin" | "super_admin">("season_admin");
  const [seasonId, setSeasonId] = useState(seasons[0]?.id ?? "");
  const [maxUses, setMaxUses] = useState(1);
  const [expiresInHours, setExpiresInHours] = useState("");
  const [pendingSuperAdminInvite, setPendingSuperAdminInvite] =
    useState<PendingSuperAdminInvite | null>(null);
  const [isPending, startTransition] = useTransition();
  const requestedRole = searchParams.get("role");
  const currentRole = ["all", "season_admin", "super_admin"].includes(requestedRole ?? "")
    ? requestedRole as AdminInviteRoleFilter
    : history.normalizedQuery.role;
  const requestedState = searchParams.get("state");
  const currentState = ["all", "usable", "expired", "revoked", "exhausted"].includes(requestedState ?? "")
    ? requestedState as AdminInviteState
    : history.normalizedQuery.state;
  const requestedSort = searchParams.get("sort");
  const currentSort = ["newest", "oldest", "expires_soon"].includes(requestedSort ?? "")
    ? requestedSort as AdminInviteSort
    : history.normalizedQuery.sort;
  const requestedSeason = searchParams.get("season") ?? "";
  const currentSeason = seasons.some((season) => season.id === requestedSeason)
    ? requestedSeason
    : history.normalizedQuery.season ?? "";

  function submitInvite(input: InviteCreateInput) {
    startTransition(async () => {
      const result = await createInviteCode(input);
      if (!result.success) {
        toast.error(result.error.message);
      } else {
        toast.success(`邀请码已生成：${result.data.code}`);
        router.refresh();
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
        router.refresh();
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
      <ListToolbar className="items-start" aria-label="邀请码历史筛选">
        <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[20%]">
          <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">角色</span>
          <select
            aria-label="邀请码角色"
            value={currentRole}
            onChange={(event) => update({ role: event.target.value })}
            className="h-9 w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm text-[var(--color-fg)]"
          >
            <option value="all">全部角色</option>
            <option value="season_admin">赛季管理员</option>
            <option value="super_admin">超级管理员</option>
          </select>
        </label>
        <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[20%]">
          <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">状态</span>
          <select
            aria-label="邀请码状态"
            value={currentState}
            onChange={(event) => update({ state: event.target.value })}
            className="h-9 w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm text-[var(--color-fg)]"
          >
            <option value="all">全部状态</option>
            <option value="usable">可用</option>
            <option value="expired">已过期</option>
            <option value="exhausted">已用尽</option>
            <option value="revoked">已撤销</option>
          </select>
        </label>
        <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[25%]">
          <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">赛季</span>
          <select
            aria-label="邀请码赛季"
            value={currentSeason}
            onChange={(event) => update({ season: event.target.value })}
            className="h-9 w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm text-[var(--color-fg)]"
          >
            <option value="">全部赛季</option>
            {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
          </select>
        </label>
        <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[20%]">
          <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">排序</span>
          <select
            aria-label="邀请码排序"
            value={currentSort}
            onChange={(event) => update({ sort: event.target.value })}
            className="h-9 w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm text-[var(--color-fg)]"
          >
            <option value="newest">最新生成</option>
            <option value="oldest">最早生成</option>
            <option value="expires_soon">即将过期</option>
          </select>
        </label>
        <ClearFilters
          defaults={ADMIN_INVITE_DEFAULTS}
          searchParams={searchParams}
          onClear={(updates) => update(updates)}
        />
      </ListToolbar>

      {history.rows.length === 0 ? (
        <p className="text-sm text-[var(--color-fg-mid)]">
          {history.hasAnyRecords ? "没有符合当前筛选条件的邀请码" : "暂无邀请码"}
        </p>
      ) : (
        <div className="space-y-2">
          {history.rows.map((inv) => (
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
                    <span>范围：{inv.seasonName ?? inv.seasonId}</span>
                  )}
                  <span>
                    使用 {inv.claimCount}/{inv.maxUses}
                  </span>
                  {inv.expiresAt && (
                    <span>
                      过期：{formatCSTShortDate(inv.expiresAt)}
                    </span>
                  )}
                  <Badge variant="outline" className="text-xs">{INVITE_STATE_LABELS[inv.state]}</Badge>
                </div>
              </div>
              {inv.state === "usable" && (
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
      <div className="flex justify-between gap-3">
        <ResultSummary
          total={history.total}
          page={history.page}
          pageSize={history.pageSize}
          totalPages={history.totalPages}
        />
      </div>
      <PaginationControls
        page={history.page}
        totalPages={history.totalPages}
        onPageChange={(page) => update({ page }, { defaults: { page: 1 }, history: "push" })}
      />
    </div>
  );
}
