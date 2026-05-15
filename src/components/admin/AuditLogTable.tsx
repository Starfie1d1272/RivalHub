"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchAuditLogs, type AuditLogFilters } from "@/actions/audit";
import { formatCST } from "@/lib/utils/date";
import type { AuditLog as DBAuditLog } from "@/db/schema/audit";

type AuditLog = Omit<DBAuditLog, "createdAt" | "meta"> & { createdAt: string; meta: Record<string, unknown> | null };

interface Props {
  initialLogs: AuditLog[];
  initialTotal: number;
  seasons: { id: string; name: string }[];
  initialActorNameMap: Record<string, string>;
  initialTargetNameMap: Record<string, string>;
}

const ACTION_CATEGORIES: Record<string, { label: string; color: string }> = {
  admin: { label: "管理", color: "var(--color-accent)" },
  registration: { label: "报名", color: "#22c55e" },
  captain: { label: "投票", color: "#a855f7" },
  captains: { label: "投票", color: "#a855f7" },
  draft: { label: "选秀", color: "#f97316" },
  match: { label: "赛程", color: "#3b82f6" },
  season: { label: "赛季", color: "#eab308" },
  team: { label: "队伍", color: "#06b6d4" },
  user: { label: "用户", color: "#ec4899" },
};

function getCategory(action: string) {
  const prefix = action.split(".")[0];
  return ACTION_CATEGORIES[prefix] ?? { label: prefix, color: "var(--color-fg-dim)" };
}

const ACTION_LABELS: Record<string, string> = {
  "admin.create_invite": "创建邀请码",
  "admin.deactivate_invite": "停用邀请码",
  "admin.register": "管理员注册",
  "admin.change_password": "修改密码",
  "admin.revoke_role": "撤销权限",
  "admin.deactivate_user": "停用用户",
  "admin.reactivate_user": "恢复用户",
  "registration.submit": "提交报名",
  "captain.cast_vote": "投票",
  "captain.retract_vote": "撤回投票",
  "captain.confirm": "确认队长",
  "draft.start": "开始选秀",
  "draft.pick": "选秀选人",
  "draft.skip_turn": "跳过回合",
  "draft.pause": "暂停选秀",
  "draft.resume": "恢复选秀",
  "match.generate_schedule": "生成赛程",
  "match.initialize_stage": "初始化阶段",
  "match.create": "创建比赛",
  "match.record_result": "录入比分",
  "match.record_map_result": "录入地图比分",
  "match.save_player_stats": "录入选手数据",
  "match.status_update": "更新比赛状态",
  "match.submit_roster": "提交阵容",
  "match.unlock_roster": "解锁阵容",
  "match.propose_time": "提议比赛时间",
  "match.respond_time_proposal": "回应时间提议",
  "match.force_set_time": "强制设定时间",
  "match.auto_award_time": "自动裁定时间",
  "match.update_scheduled_at": "更新比赛时间",
  "match.update_completion_deadline": "更新完赛截止",
  "season.create": "创建赛季",
  "season.update": "更新赛季",
  "season.publish": "发布赛季",
  "season.deleted": "删除赛季",
  "season.auto_advance": "自动推进阶段",
  "team.rename": "队伍改名",
  "team.upload_logo": "上传队标",
  "user.change_password": "修改密码",
  "user.claim_invite": "使用邀请码",
};

const PAGE_SIZE = 50;

export function AuditLogTable({ initialLogs, initialTotal, seasons, initialActorNameMap, initialTargetNameMap }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [logs, setLogs] = useState(initialLogs);
  const [total, setTotal] = useState(initialTotal);
  const [actorNameMap, setActorNameMap] = useState(initialActorNameMap);
  const [targetNameMap, setTargetNameMap] = useState(initialTargetNameMap);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [localActor, setLocalActor] = useState(searchParams.get("actor") ?? "");

  const actorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const currentPage = Number(searchParams.get("page") ?? "1");
  const currentAction = searchParams.get("action") ?? "";
  const currentActor = searchParams.get("actor") ?? "";
  const currentSeason = searchParams.get("seasonId") ?? "";
  const currentDateFrom = searchParams.get("dateFrom") ?? "";
  const currentDateTo = searchParams.get("dateTo") ?? "";

  useEffect(() => {
    setLocalActor(currentActor);
  }, [currentActor]);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      if (!updates.page) params.set("page", "1");
      router.push(`/admin/logs?${params.toString()}`);
    },
    [router, searchParams],
  );

  const debouncedUpdateParam = useCallback(
    (key: string, value: string, timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>) => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        updateParams({ [key]: value });
      }, 400);
    },
    [updateParams],
  );

  const reload = useCallback(() => {
    const filters: AuditLogFilters = {
      page: currentPage,
      pageSize: PAGE_SIZE,
    };
    if (currentAction) filters.action = currentAction;
    if (currentActor) filters.actorId = currentActor;
    if (currentSeason) filters.seasonId = currentSeason;
    if (currentDateFrom) filters.dateFrom = currentDateFrom;
    if (currentDateTo) filters.dateTo = currentDateTo;

    startTransition(async () => {
      const result = await fetchAuditLogs(filters);
      if (result.success) {
        setLogs(result.data.logs);
        setTotal(result.data.total);
        if (result.data.actorNameMap) setActorNameMap(result.data.actorNameMap);
        if (result.data.targetNameMap) setTargetNameMap(result.data.targetNameMap);
      }
    });
  }, [currentPage, currentAction, currentActor, currentSeason, currentDateFrom, currentDateTo]);

  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    reload();
  }, [reload]);

  useEffect(() => {
    return () => {
      clearTimeout(actorTimerRef.current);
    };
  }, []);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* filters */}
      <div
        className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 rounded-md"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}
      >
        <div>
          <label className="block text-xs mb-1" style={{ color: "var(--color-fg-dim)" }}>
            操作类型
          </label>
          <select
            value={currentAction}
            onChange={(e) => updateParams({ action: e.target.value })}
            className="w-full px-2 py-1.5 rounded text-xs"
            style={{
              background: "var(--color-panel-low)",
              border: "1px solid var(--color-border)",
              color: "var(--color-fg)",
            }}
          >
            <option value="">全部操作</option>
            {Object.entries(ACTION_CATEGORIES).reduce<[string, [string, string][]][]>((groups, [prefix, cat]) => {
              const items = Object.entries(ACTION_LABELS).filter(([k]) => k.startsWith(prefix + "."));
              if (items.length && !groups.some(([label]) => label === cat.label)) {
                groups.push([cat.label, items]);
              }
              return groups;
            }, []).map(([groupLabel, items]) => (
              <optgroup key={groupLabel} label={groupLabel}>
                {items.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs mb-1" style={{ color: "var(--color-fg-dim)" }}>
            操作人
          </label>
          <input
            type="text"
            placeholder="用户 ID 或邮箱"
            value={localActor}
            onChange={(e) => {
              setLocalActor(e.target.value);
              debouncedUpdateParam("actor", e.target.value, actorTimerRef);
            }}
            className="w-full px-2 py-1.5 rounded text-xs"
            style={{
              background: "var(--color-panel-low)",
              border: "1px solid var(--color-border)",
              color: "var(--color-fg)",
            }}
          />
        </div>
        <div>
          <label className="block text-xs mb-1" style={{ color: "var(--color-fg-dim)" }}>
            赛季
          </label>
          <select
            value={currentSeason}
            onChange={(e) => updateParams({ seasonId: e.target.value })}
            className="w-full px-2 py-1.5 rounded text-xs"
            style={{
              background: "var(--color-panel-low)",
              border: "1px solid var(--color-border)",
              color: "var(--color-fg)",
            }}
          >
            <option value="">全部赛季</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs mb-1" style={{ color: "var(--color-fg-dim)" }}>
              起始日期
            </label>
            <input
              type="date"
              value={currentDateFrom}
              onChange={(e) => updateParams({ dateFrom: e.target.value })}
              className="w-full px-2 py-1.5 rounded text-xs"
              style={{
                background: "var(--color-panel-low)",
                border: "1px solid var(--color-border)",
                color: "var(--color-fg)",
              }}
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs mb-1" style={{ color: "var(--color-fg-dim)" }}>
              结束日期
            </label>
            <input
              type="date"
              value={currentDateTo}
              onChange={(e) => updateParams({ dateTo: e.target.value })}
              className="w-full px-2 py-1.5 rounded text-xs"
              style={{
                background: "var(--color-panel-low)",
                border: "1px solid var(--color-border)",
                color: "var(--color-fg)",
              }}
            />
          </div>
        </div>
      </div>

      {/* summary */}
      <div className="flex items-center justify-between text-xs" style={{ color: "var(--color-fg-dim)" }}>
        <span>
          共 {total} 条记录{totalPages > 1 ? `，第 ${currentPage}/${totalPages} 页` : ""}
        </span>
        {isPending && <span style={{ color: "var(--color-accent)" }}>加载中…</span>}
      </div>

      {/* table */}
      <div
        className="rounded-md overflow-hidden"
        style={{ border: "1px solid var(--color-border)" }}
      >
        <table className="w-full text-xs" style={{ fontFamily: "var(--font-mono)" }}>
          <thead>
            <tr style={{ background: "var(--color-panel)", borderBottom: "1px solid var(--color-border)" }}>
              <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--color-fg-mid)" }}>时间</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--color-fg-mid)" }}>操作</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--color-fg-mid)" }}>操作人</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--color-fg-mid)" }}>目标</th>
              <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--color-fg-mid)" }}>详情</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-8" style={{ color: "var(--color-fg-dim)" }}>
                  暂无日志记录
                </td>
              </tr>
            )}
            {logs.map((log) => {
              const cat = getCategory(log.action);
              const isExpanded = expandedId === log.id;
              return (
                <tr
                  key={log.id}
                  className="group"
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                >
                  <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--color-fg-mid)" }}>
                    {formatCST(log.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium mr-1.5"
                      style={{ background: cat.color, color: "#000", opacity: 0.9 }}
                    >
                      {cat.label}
                    </span>
                    <span title={log.action} style={{ color: "var(--color-fg)" }}>{ACTION_LABELS[log.action] ?? log.action}</span>
                  </td>
                  <td className="px-3 py-2 truncate max-w-[140px]" style={{ color: "var(--color-fg-mid)" }}>
                    {log.actorId ? (actorNameMap[log.actorId] ?? log.actorId.slice(0, 8)) : "—"}
                  </td>
                  <td className="px-3 py-2" style={{ color: "var(--color-fg-mid)" }}>
                    {log.targetType && (
                      <span className="opacity-60 mr-1">{log.targetType}:</span>
                    )}
                    <span className="truncate inline-block max-w-[160px] align-bottom" title={log.targetId ?? undefined}>
                      {(log.targetId && targetNameMap[log.targetId]) || log.targetId?.slice(0, 8) || "-"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {log.meta ? (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                        className="text-[10px] underline"
                        style={{ color: "var(--color-accent)" }}
                      >
                        {isExpanded ? "收起" : "展开"}
                      </button>
                    ) : (
                      <span style={{ color: "var(--color-fg-dim)" }}>-</span>
                    )}
                    {isExpanded && log.meta && (
                      <pre
                        className="mt-1 p-2 rounded text-[10px] whitespace-pre-wrap break-all"
                        style={{
                          background: "var(--color-panel-low)",
                          color: "var(--color-fg-mid)",
                          maxWidth: 300,
                          maxHeight: 200,
                          overflow: "auto",
                        }}
                      >
                        {JSON.stringify(log.meta, null, 2)}
                      </pre>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={currentPage <= 1}
            onClick={() => updateParams({ page: String(currentPage - 1) })}
            className="px-3 py-1 rounded text-xs disabled:opacity-30"
            style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }}
          >
            上一页
          </button>
          <span className="text-xs" style={{ color: "var(--color-fg-dim)" }}>
            {currentPage} / {totalPages}
          </span>
          <button
            disabled={currentPage >= totalPages}
            onClick={() => updateParams({ page: String(currentPage + 1) })}
            className="px-3 py-1 rounded text-xs disabled:opacity-30"
            style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
