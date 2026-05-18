"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { reviewRegistration } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { positionLabel } from "@/lib/validators/registration";
import { getDisplayName } from "@/lib/utils/display-name";
import { REGISTRATION_STATUS_LABELS } from "@/types/registration";
import { MapPreferenceChips } from "@/components/rivalhub/map-preference-chips";
import type { MapPreference } from "@/types/season";

// ── 类型 ──────────────────────────────────────────────

export interface RegistrationRow {
  id: string;
  primaryPosition: string;
  secondaryPosition: string;
  peakRank: string;
  peakRankSeason: string;
  peakRating: number;
  currentSeasonPeakRank: string;
  currentRating: number;
  screenshotUrls: string[];
  mapPreferences: MapPreference[];
  gameplayStyle: string;
  competitionHistory: string | null;
  notes: string | null;
  willingToBeCaptain: boolean;
  status: string;
  createdAt: string;
  // user
  email: string;
  studentId: string | null;
  steamName: string | null;
  displayName: string | null;
  perfectName: string | null;
  steam64: string | null;
  steamProfileUrl: string | null;
  qq: string | null;
}

type FilterStatus = "all" | "pending" | "approved" | "rejected" | "waitlisted";

// ── 状态徽章 ──────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  pending:    "bg-[rgba(255,196,77,0.10)] text-[var(--color-warn)] border-[rgba(255,196,77,0.3)]",
  approved:   "bg-[rgba(77,212,122,0.10)] text-[var(--color-ok)] border-[rgba(77,212,122,0.3)]",
  rejected:   "bg-[rgba(255,84,112,0.08)] text-[var(--color-danger)] border-[rgba(255,84,112,0.3)]",
  waitlisted: "bg-[var(--color-info-soft)] text-[var(--color-info)] border-[var(--color-info-edge)]",
};

// ── 位置标签 ──────────────────────────────────────────

// ── 组件 ──────────────────────────────────────────────

interface Props {
  registrations: RegistrationRow[];
}

export function RegistrationReviewList({ registrations }: Props) {
  const [filter, setFilter] = useState<FilterStatus>("pending");
  const [isPending, startTransition] = useTransition();

  const filtered =
    filter === "all"
      ? registrations
      : registrations.filter((r) => r.status === filter);

  const counts: Record<FilterStatus, number> = {
    all: registrations.length,
    pending: registrations.filter((r) => r.status === "pending").length,
    approved: registrations.filter((r) => r.status === "approved").length,
    rejected: registrations.filter((r) => r.status === "rejected").length,
    waitlisted: registrations.filter((r) => r.status === "waitlisted").length,
  };

  function handleReview(registrationId: string, status: "pending" | "approved" | "rejected" | "waitlisted") {
    const label = REGISTRATION_STATUS_LABELS[status];
    startTransition(async () => {
      const result = await reviewRegistration({ registrationId, status });
      if (!result.success) {
        toast.error(result.error.message);
      } else {
        toast.success(`已${label}`);
      }
    });
  }

  const FILTERS: { key: FilterStatus; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "pending", label: "待审核" },
    { key: "approved", label: "已通过" },
    { key: "rejected", label: "已拒绝" },
    { key: "waitlisted", label: "候补名单" },
  ];

  return (
    <div>
      {/* 筛选标签 */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            variant={filter === f.key ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f.key)}
          >
            {f.label} ({counts[f.key]})
          </Button>
        ))}
      </div>

      <Separator className="mb-4" />

      {/* 列表 */}
      {filtered.length === 0 ? (
        <p className="text-[var(--color-fg-mid)] py-8 text-center">
          暂无{filter !== "all" ? REGISTRATION_STATUS_LABELS[filter] : ""}报名
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                {/* 左侧：用户信息 */}
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{getDisplayName(r)}</span>
                    <Badge variant="outline" className={STATUS_STYLES[r.status]}>
                      {REGISTRATION_STATUS_LABELS[r.status as keyof typeof REGISTRATION_STATUS_LABELS]}
                    </Badge>
                    {r.willingToBeCaptain && (
                      <Badge variant="secondary" className="text-xs">
                        队长意向
                      </Badge>
                    )}
                  </div>

                  <div className="text-sm text-[var(--color-fg-mid)] space-y-0.5">
                    <p>
                      位置：{positionLabel(r.primaryPosition)}（主）|{" "}
                      {positionLabel(r.secondaryPosition)}（次）
                    </p>
                    <p>
                      最高段位：{r.peakRank}（{r.peakRankSeason}）Rating {r.peakRating}
                      {" | "}当前赛季：{r.currentSeasonPeakRank} Rating {r.currentRating}
                    </p>
                    <p>
                      {r.email}
                      {r.qq && ` | QQ: ${r.qq}`}
                      {r.studentId && ` | 学号: ${r.studentId}`}
                    </p>
                    {r.steam64 && (
                      <p>
                        Steam64: {r.steam64}
                        {r.steamProfileUrl && (
                          <>
                            {" | "}
                            <a
                              href={r.steamProfileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline hover:text-[var(--color-fg)]"
                            >
                              Steam 主页
                            </a>
                          </>
                        )}
                      </p>
                    )}
                    {r.gameplayStyle && <p>风格：{r.gameplayStyle}</p>}
                    {r.competitionHistory && <p>比赛经历：{r.competitionHistory}</p>}
                    {r.notes && <p>备注：{r.notes}</p>}
                  </div>

                  <div className="mt-2">
                    <MapPreferenceChips preferences={r.mapPreferences} minLevel="playable" />
                  </div>

                  {/* 截图链接 */}
                  {r.screenshotUrls.length > 0 && (
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {r.screenshotUrls.map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs underline text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
                        >
                          截图 {i + 1}
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                {/* 右侧：操作按钮 */}
                <div className="flex flex-col gap-1.5 shrink-0">
                  {r.status === "pending" && (
                    <>
                      <Button
                        size="sm"
                        variant="default"
                        disabled={isPending}
                        onClick={() => handleReview(r.id, "approved")}
                      >
                        通过
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => handleReview(r.id, "waitlisted")}
                      >
                        候补
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => handleReview(r.id, "rejected")}
                      >
                        拒绝
                      </Button>
                    </>
                  )}
                  {r.status === "waitlisted" && (
                    <>
                      <Button
                        size="sm"
                        variant="default"
                        disabled={isPending}
                        onClick={() => handleReview(r.id, "approved")}
                      >
                        通过
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => handleReview(r.id, "rejected")}
                      >
                        拒绝
                      </Button>
                    </>
                  )}
                  {r.status === "approved" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => handleReview(r.id, "pending")}
                    >
                      撤回待审
                    </Button>
                  )}
                  {r.status === "rejected" && (
                    <>
                      <Button
                        size="sm"
                        variant="default"
                        disabled={isPending}
                        onClick={() => handleReview(r.id, "approved")}
                      >
                        改为通过
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => handleReview(r.id, "pending")}
                      >
                        回到待审
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
