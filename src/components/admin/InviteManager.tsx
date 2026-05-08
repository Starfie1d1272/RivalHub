"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createInviteCode, deactivateInviteCode } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

interface InviteRow {
  id: string;
  code: string;
  role: "super_admin" | "admin";
  seasonId: string | null;
  maxUses: number;
  usedCount: number;
  usedByUsernames: string[];
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

interface SeasonOption {
  id: string;
  name: string;
  slug: string;
}

export function InviteManager({
  invites: initialInvites,
  seasons,
}: {
  invites: InviteRow[];
  seasons: SeasonOption[];
}) {
  const [invites, setInvites] = useState(initialInvites);
  const [role, setRole] = useState<"admin" | "super_admin">("admin");
  const [seasonId, setSeasonId] = useState(seasons[0]?.id ?? "");
  const [maxUses, setMaxUses] = useState(1);
  const [expiresInHours, setExpiresInHours] = useState("");
  const [isPending, startTransition] = useTransition();
  const seasonNameById = new Map(seasons.map((season) => [season.id, season.name]));

  function handleCreate() {
    startTransition(async () => {
      const result = await createInviteCode({
        role,
        seasonId: role === "admin" ? seasonId : undefined,
        maxUses: maxUses || 1,
        expiresInHours: expiresInHours ? Number(expiresInHours) : undefined,
      });
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
            usedCount: 0,
            usedByUsernames: [],
            expiresAt: result.data.expiresAt,
            isActive: true,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
      }
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
              className="h-9 rounded-md border border-[var(--border)] bg-transparent px-3 text-sm"
              value={role}
              onChange={(e) =>
                setRole(e.target.value as "admin" | "super_admin")
              }
            >
              <option value="admin">管理员</option>
              <option value="super_admin">超级管理员</option>
            </select>
          </div>
          {role === "admin" && (
            <div className="space-y-1 min-w-44">
              <Label htmlFor="inv-season">赛季范围</Label>
              <select
                id="inv-season"
                className="h-9 rounded-md border border-[var(--border)] bg-transparent px-3 text-sm w-full"
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
            disabled={isPending || (role === "admin" && !seasonId)}
          >
            生成邀请码
          </Button>
        </div>
      </Card>

      <Separator />

      {/* 邀请码列表 */}
      <h2 className="font-medium">历史邀请码</h2>
      {invites.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">暂无邀请码</p>
      ) : (
        <div className="space-y-2">
          {invites.map((inv) => (
            <Card
              key={inv.id || inv.code}
              className="p-3 flex items-center justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <code className="text-sm font-mono">{inv.code}</code>
                <div className="flex items-center gap-2 mt-1 text-xs text-[var(--text-secondary)]">
                  <Badge variant="outline" className="text-xs">
                    {inv.role === "super_admin" ? "超级管理员" : "管理员"}
                  </Badge>
                  {inv.role === "admin" && inv.seasonId && (
                    <span>范围：{seasonNameById.get(inv.seasonId) ?? inv.seasonId}</span>
                  )}
                  <span>
                    使用 {inv.usedCount}/{inv.maxUses}
                  </span>
                  {inv.usedByUsernames.length > 0 && (
                    <span>使用者：{inv.usedByUsernames.join("、")}</span>
                  )}
                  {inv.expiresAt && (
                    <span>
                      过期：{new Date(inv.expiresAt).toLocaleDateString("zh-CN")}
                    </span>
                  )}
                  {!inv.isActive && (
                    <Badge
                      variant="outline"
                      className="text-xs bg-red-500/10 text-red-600 border-red-500/20"
                    >
                      已失效
                    </Badge>
                  )}
                </div>
              </div>
              {inv.isActive && inv.usedCount < inv.maxUses && (
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
