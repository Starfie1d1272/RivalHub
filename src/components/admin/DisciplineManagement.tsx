"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { expireSanction, issueSanction, revokeSanction, searchSanctionSubjects } from "@/actions/discipline";
import type { ResolvedSanctionStatus, SanctionEffect } from "@/lib/discipline/service";
import { SANCTION_EFFECTS } from "@/lib/discipline/service";
import { formatCST, parseCSTInput } from "@/lib/utils/date";
import { EmptyState, Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";

/**
 * 管理员专用 discipline 面板。`internalEvidence` 仅出现在本组件的
 * props（由 admin page 构造）中，任何公开 surface 都不得复用该类型。
 * Subject 不做批量下发，一律按需搜索。
 */
export type DisciplineSanctionRow = {
  id: string;
  subjectUserId: string;
  subjectLabel: string;
  storedStatus: "draft" | "active" | "expired" | "revoked";
  resolvedStatus: ResolvedSanctionStatus;
  effects: string[];
  internalEvidence: string | null;
  publicExplanation: string | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  createdAt: string;
};

export type DisciplineSubjectOption = {
  id: string;
  label: string;
  detail: string | null;
};

const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

const EFFECT_LABELS: Record<SanctionEffect, string> = {
  registration_block: "报名拦截",
  roster_block: "名单拦截",
  match_participation_block: "参赛拦截",
};

const STATUS_LABELS: Record<ResolvedSanctionStatus, string> = {
  draft: "未生效",
  active: "生效中",
  expired: "已到期",
  revoked: "已撤销",
};

const FILTERS = ["all", "active", "draft", "expired", "revoked"] as const;
type StatusFilter = (typeof FILTERS)[number];

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: "全部",
  active: "生效中",
  draft: "未生效",
  expired: "已到期",
  revoked: "已撤销",
};

function describeWindow(row: DisciplineSanctionRow): string {
  const from = formatCST(row.effectiveFrom);
  if (row.effectiveUntil === null) return `${from} 起 · 长期有效`;
  return `${from} → ${formatCST(row.effectiveUntil)}`;
}

export function DisciplineManagement({
  seasonId,
  sanctions,
}: {
  seasonId: string;
  sanctions: DisciplineSanctionRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [subjectQuery, setSubjectQuery] = useState("");
  const [subjectResults, setSubjectResults] = useState<DisciplineSubjectOption[]>([]);
  const [subjectSearchError, setSubjectSearchError] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<DisciplineSubjectOption | null>(null);
  const [effects, setEffects] = useState<SanctionEffect[]>([]);
  const [internalEvidence, setInternalEvidence] = useState("");
  const [publicExplanation, setPublicExplanation] = useState("");
  const [effectiveUntilInput, setEffectiveUntilInput] = useState("");
  const [issueError, setIssueError] = useState<string | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const query = subjectQuery.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setSubjectResults([]);
      setSubjectSearchError(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const result = await searchSanctionSubjects({ seasonId, query });
        if (result.success) {
          setSubjectResults(result.data);
          setSubjectSearchError(null);
        } else {
          setSubjectResults([]);
          setSubjectSearchError(result.error.message);
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [seasonId, subjectQuery]);

  const subjectOptions = useMemo(() => {
    const options = [...subjectResults];
    if (selectedSubject && !options.some((o) => o.id === selectedSubject.id)) {
      options.unshift(selectedSubject);
    }
    return options;
  }, [subjectResults, selectedSubject]);

  const visibleSanctions = useMemo(
    () =>
      [...sanctions]
        .filter((row) => statusFilter === "all" || row.resolvedStatus === statusFilter)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [sanctions, statusFilter],
  );

  function toggleEffect(effect: SanctionEffect) {
    setEffects((prev) =>
      prev.includes(effect) ? prev.filter((e) => e !== effect) : [...prev, effect],
    );
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  function handleIssue() {
    setIssueError(null);
    if (!selectedSubject) {
      setIssueError("请先搜索并选择被处罚用户。");
      return;
    }
    if (effects.length === 0) {
      setIssueError("请至少选择一项处罚效果。");
      return;
    }
    const effectiveUntil = parseCSTInput(effectiveUntilInput || null);
    startTransition(async () => {
      const result = await issueSanction({
        seasonId,
        subjectUserId: selectedSubject.id,
        effects,
        internalEvidence: internalEvidence.trim() || null,
        publicExplanation: publicExplanation.trim() || null,
        effectiveUntil,
      });
      if (result.success) {
        toast.success("处罚已签发。");
        setSelectedSubject(null);
        setSubjectQuery("");
        setSubjectResults([]);
        setEffects([]);
        setInternalEvidence("");
        setPublicExplanation("");
        setEffectiveUntilInput("");
        refresh();
      } else {
        setIssueError(result.error.message);
        toast.error(result.error.message);
      }
    });
  }

  function handleRevoke(caseId: string) {
    setRowErrors((prev) => ({ ...prev, [caseId]: "" }));
    if (!revokeReason.trim()) {
      setRowErrors((prev) => ({ ...prev, [caseId]: "必须填写撤销原因。" }));
      return;
    }
    startTransition(async () => {
      const result = await revokeSanction({ caseId, reason: revokeReason.trim() });
      if (result.success) {
        toast.success(result.data.alreadyRevoked ? "该处罚已被撤销过。" : "处罚已撤销。");
        setRevokeTarget(null);
        setRevokeReason("");
        refresh();
      } else {
        setRowErrors((prev) => ({ ...prev, [caseId]: result.error.message }));
        toast.error(result.error.message);
      }
    });
  }

  function handleExpire(caseId: string) {
    setRowErrors((prev) => ({ ...prev, [caseId]: "" }));
    startTransition(async () => {
      const result = await expireSanction({ caseId });
      if (result.success) {
        toast.success(result.data.alreadyExpired ? "该处罚已被标记过期。" : "处罚已标记过期。");
        refresh();
      } else {
        setRowErrors((prev) => ({ ...prev, [caseId]: result.error.message }));
        toast.error(result.error.message);
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--color-fg)]">签发处罚</h2>
        <Panel contentClassName="space-y-4 p-5">
          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-fg-mid)]" htmlFor="discipline-subject-search">
              搜索被处罚用户（姓名 / Steam 昵称 / 邮箱，至少 2 个字符）
            </label>
            <input
              id="discipline-subject-search"
              type="search"
              value={subjectQuery}
              onChange={(e) => setSubjectQuery(e.target.value)}
              placeholder="输入关键字按需搜索…"
              className="w-full max-w-sm rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] outline-none focus:border-[var(--color-accent)] transition-colors"
            />
            {subjectSearchError && (
              <p role="alert" className="text-sm text-[var(--color-danger)]">{subjectSearchError}</p>
            )}
            <select
              aria-label="选择被处罚用户"
              value={selectedSubject?.id ?? ""}
              onChange={(e) => {
                const picked = subjectOptions.find((o) => o.id === e.target.value) ?? null;
                setSelectedSubject(picked);
              }}
              className="w-full max-w-sm rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)] transition-colors"
            >
              <option value="">— 选择用户 —</option>
              {subjectOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {s.detail ? `（${s.detail}）` : ""}
                </option>
              ))}
            </select>
            {subjectQuery.trim().length >= MIN_QUERY_LENGTH && subjectResults.length === 0 && !subjectSearchError && (
              <p className="text-xs text-[var(--color-fg-mid)]">没有匹配的用户。</p>
            )}
          </div>

          <div className="space-y-2">
            <span className="block text-sm text-[var(--color-fg-mid)]">处罚效果（至少一项）</span>
            <div className="flex flex-wrap gap-3">
              {SANCTION_EFFECTS.map((effect) => (
                <label key={effect} className="flex items-center gap-1.5 text-sm text-[var(--color-fg)]">
                  <input
                    type="checkbox"
                    checked={effects.includes(effect)}
                    onChange={() => toggleEffect(effect)}
                  />
                  {EFFECT_LABELS[effect]}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-fg-mid)]" htmlFor="discipline-internal-evidence">
              内部证据（仅管理员可见）
            </label>
            <textarea
              id="discipline-internal-evidence"
              value={internalEvidence}
              onChange={(e) => setInternalEvidence(e.target.value)}
              rows={3}
              maxLength={4000}
              className="w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)] transition-colors"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-fg-mid)]" htmlFor="discipline-public-explanation">
              公开说明（可能展示给被处罚用户）
            </label>
            <textarea
              id="discipline-public-explanation"
              value={publicExplanation}
              onChange={(e) => setPublicExplanation(e.target.value)}
              rows={2}
              maxLength={1000}
              className="w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)] transition-colors"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-fg-mid)]" htmlFor="discipline-effective-until">
              有效期至（北京时间，留空为长期有效）
            </label>
            <input
              id="discipline-effective-until"
              type="datetime-local"
              value={effectiveUntilInput}
              onChange={(e) => setEffectiveUntilInput(e.target.value)}
              className="rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)] transition-colors"
            />
          </div>

          {issueError && (
            <p role="alert" className="text-sm text-[var(--color-danger)]">{issueError}</p>
          )}

          <Button type="button" variant="outline" onClick={handleIssue} disabled={pending}>签发处罚</Button>
        </Panel>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--color-fg)]">处罚记录</h2>
        <div className="flex gap-1">
          {FILTERS.map((key) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={statusFilter !== key ? "ghost" : "outline"}
              onClick={() => setStatusFilter(key)}
            >
              {FILTER_LABELS[key]}
            </Button>
          ))}
        </div>

        {visibleSanctions.length === 0 ? (
          <EmptyState title="本赛事暂无纪律处罚记录" />
        ) : (
          <div className="space-y-3">
            {visibleSanctions.map((row) => (
              <Panel key={row.id} contentClassName="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-[var(--color-fg)]">{row.subjectLabel}</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs"
                    data-status={row.resolvedStatus}
                    style={
                      row.resolvedStatus === "active"
                        ? { background: "color-mix(in srgb, var(--color-danger) 12%, transparent)", color: "var(--color-danger)" }
                        : { background: "var(--color-panel-low)", color: "var(--color-fg-mid)" }
                    }
                  >
                    {STATUS_LABELS[row.resolvedStatus]}
                  </span>
                  {row.effects.map((effect) => (
                    <span
                      key={effect}
                      className="rounded-sm border border-[var(--color-border)] px-1.5 py-0.5 text-xs text-[var(--color-fg-mid)]"
                    >
                      {EFFECT_LABELS[effect as SanctionEffect] ?? effect}
                    </span>
                  ))}
                </div>
                <p className="text-sm text-[var(--color-fg-mid)]">生效窗口：{describeWindow(row)}</p>
                <p className="text-sm">公开说明：{row.publicExplanation ?? "—"}</p>
                {row.internalEvidence && (
                  <p className="text-sm">
                    内部证据：<span className="text-[var(--color-fg-mid)]">{row.internalEvidence}</span>
                  </p>
                )}
                {row.revocationReason && (
                  <p className="text-sm text-[var(--color-fg-mid)]">撤销原因：{row.revocationReason}</p>
                )}
                {rowErrors[row.id] && (
                  <p role="alert" className="text-sm text-[var(--color-danger)]">{rowErrors[row.id]}</p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {row.resolvedStatus !== "revoked" && (
                    <Button type="button" size="sm" variant="destructive" onClick={() => { setRevokeTarget(revokeTarget === row.id ? null : row.id); setRevokeReason(""); }}>
                      撤销
                    </Button>
                  )}
                  {row.storedStatus === "active" && row.resolvedStatus === "expired" && (
                    <Button type="button" size="sm" variant="outline" onClick={() => handleExpire(row.id)} disabled={pending}>
                      标记过期
                    </Button>
                  )}
                </div>
                {revokeTarget === row.id && (
                  <div className="space-y-2 rounded-sm border border-[var(--color-border)] p-3">
                    <label className="block text-sm text-[var(--color-fg-mid)]" htmlFor={`revoke-reason-${row.id}`}>
                      撤销原因（必填）
                    </label>
                    <textarea
                      id={`revoke-reason-${row.id}`}
                      value={revokeReason}
                      onChange={(e) => setRevokeReason(e.target.value)}
                      rows={2}
                      maxLength={1000}
                      className="w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)] transition-colors"
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleRevoke(row.id)}
                        disabled={pending || !revokeReason.trim()}
                      >
                        确认撤销
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => { setRevokeTarget(null); setRevokeReason(""); }}>
                        取消
                      </Button>
                    </div>
                  </div>
                )}
              </Panel>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
