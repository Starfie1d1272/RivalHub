"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  expireSanction as telemetry_expireSanction,
  issueSanction as telemetry_issueSanction,
  revokeSanction as telemetry_revokeSanction,
  searchSanctionSubjects,
} from "@/actions/discipline";
import type { SanctionEffect } from "@/lib/discipline/contract";
import { SANCTION_EFFECTS } from "@/lib/discipline/contract";
import { formatCST, parseCSTInput } from "@/lib/utils/date";
import {
  ClearFilters,
  EmptyState,
  ListSearchField,
  ListToolbar,
  PaginationControls,
  Panel,
  ResultSummary,
  type ListSearchFieldHandle,
  useListQueryParams,
} from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DISCIPLINE_ADMIN_DEFAULTS,
  type DisciplineAdminQuery,
  type DisciplineSanctionRow,
  type DisciplineSubjectOption,
} from "@/lib/discipline/admin-review-contract";
import { observeAction } from "@/lib/telemetry/client";

const expireSanction = observeAction("discipline.expireSanction", telemetry_expireSanction);
const issueSanction = observeAction("discipline.issueSanction", telemetry_issueSanction);
const revokeSanction = observeAction("discipline.revokeSanction", telemetry_revokeSanction);

export type {
  DisciplineSanctionRow,
  DisciplineSubjectOption,
} from "@/lib/discipline/admin-review-contract";

/**
 * 管理员专用 discipline 面板。`internalEvidence` 仅出现在本组件的
 * props（由 admin page 构造）中，任何公开 surface 都不得复用该类型。
 * Subject 不做批量下发，一律按需搜索。
 */
const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

interface SubjectSearch {
  seasonId: string;
  query: string;
  result: { success: true; data: DisciplineSubjectOption[] } | { success: false; error: string };
}

interface SanctionPreview {
  seasonId: string;
  subject: DisciplineSubjectOption;
  effects: SanctionEffect[];
  internalEvidence: string | null;
  publicExplanation: string | null;
  effectiveUntil: Date | null;
}

const EFFECT_LABELS: Record<SanctionEffect, string> = {
  registration_block: "报名拦截",
  roster_block: "名单拦截",
  match_participation_block: "参赛拦截",
};

const STATUS_LABELS: Record<DisciplineSanctionRow["resolvedStatus"], string> = {
  draft: "未生效",
  active: "生效中",
  expired: "已到期",
  revoked: "已撤销",
};

const STATUS_OPTIONS = [
  { value: "active", label: "生效中" },
  { value: "draft", label: "未生效" },
  { value: "expired", label: "已到期" },
  { value: "revoked", label: "已撤销" },
  { value: "all", label: "全部状态" },
] as const;

function describeWindow(row: DisciplineSanctionRow): string {
  const from = formatCST(row.effectiveFrom);
  if (row.effectiveUntil === null) return `${from} 起 · 长期有效`;
  return `${from} → ${formatCST(row.effectiveUntil)}`;
}

interface DisciplineManagementProps {
  seasonId: string;
  seasonSlug: string;
  sanctions: DisciplineSanctionRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  normalizedQuery: DisciplineAdminQuery;
  hasAnyRecords: boolean;
}

export function DisciplineManagement({
  seasonId,
  seasonSlug,
  sanctions,
  total,
  page,
  pageSize,
  totalPages,
  normalizedQuery,
  hasAnyRecords,
}: DisciplineManagementProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { update } = useListQueryParams({
    routeBase: `/admin/${seasonSlug}/discipline`,
    defaults: DISCIPLINE_ADMIN_DEFAULTS,
  });
  const searchFieldRef = useRef<ListSearchFieldHandle>(null);
  const [pending, startTransition] = useTransition();

  const [subjectQuery, setSubjectQuery] = useState("");
  const [subjectSearch, setSubjectSearch] = useState<SubjectSearch | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [effects, setEffects] = useState<SanctionEffect[]>([]);
  const [internalEvidence, setInternalEvidence] = useState("");
  const [publicExplanation, setPublicExplanation] = useState("");
  const [effectiveUntilInput, setEffectiveUntilInput] = useState("");
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issuePreview, setIssuePreview] = useState<SanctionPreview | null>(null);
  const [issueOutcomeUnknown, setIssueOutcomeUnknown] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const query = subjectQuery.trim();
  const currentSearch =
    subjectSearch?.seasonId === seasonId && subjectSearch.query === query
      ? subjectSearch.result
      : null;
  const subjectOptions = currentSearch?.success ? currentSearch.data : [];
  const selectedSubject = subjectOptions.find(({ id }) => id === selectedSubjectId);
  const preview = issuePreview?.seasonId === seasonId ? issuePreview : null;

  useEffect(() => {
    if (query.length < MIN_QUERY_LENGTH) return;
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const result = await searchSanctionSubjects({ seasonId, query });
        if (current) {
          setSubjectSearch({
            seasonId,
            query,
            result: result.success ? result : { success: false, error: result.error.message },
          });
        }
      } catch {
        if (current) {
          setSubjectSearch({
            seasonId,
            query,
            result: { success: false, error: "搜索暂时不可用，请调整关键词后重试。" },
          });
        }
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [seasonId, query]);

  const requestedStatus = searchParams.get("status");
  const currentStatus = STATUS_OPTIONS.some((option) => option.value === requestedStatus)
    ? (requestedStatus as DisciplineAdminQuery["status"])
    : normalizedQuery.status;

  function toggleEffect(effect: SanctionEffect) {
    setEffects((prev) =>
      prev.includes(effect) ? prev.filter((e) => e !== effect) : [...prev, effect],
    );
  }

  function handleSubjectQueryChange(value: string) {
    setSubjectQuery(value);
    if (value.trim() !== query) {
      setSubjectSearch(null);
      setSelectedSubjectId("");
      setIssueError(null);
    }
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  function prepareIssue() {
    setIssueError(null);
    setIssueOutcomeUnknown(false);
    if (!selectedSubject) {
      setIssueError("请先搜索并选择被处罚用户。");
      return;
    }
    if (effects.length === 0) {
      setIssueError("请至少选择一项处罚效果。");
      return;
    }
    const effectiveUntil = parseCSTInput(effectiveUntilInput);
    if (effectiveUntilInput && !effectiveUntil) {
      setIssueError("请输入有效的结束时间，或留空以长期生效。");
      return;
    }
    setIssuePreview({
      seasonId,
      subject: selectedSubject,
      effects,
      internalEvidence: internalEvidence.trim() || null,
      publicExplanation: publicExplanation.trim() || null,
      effectiveUntil,
    });
  }

  function handleIssue(confirmed: SanctionPreview) {
    setIssueError(null);
    const { subject, ...sanction } = confirmed;
    startTransition(async () => {
      try {
        const result = await issueSanction({ ...sanction, subjectUserId: subject.id });
        if (!result.success) {
          setIssueError(result.error.message);
          return;
        }
        toast.success("处罚已签发。");
        setIssuePreview(null);
        setSelectedSubjectId("");
        setSubjectQuery("");
        setSubjectSearch(null);
        setEffects([]);
        setInternalEvidence("");
        setPublicExplanation("");
        setEffectiveUntilInput("");
        refresh();
      } catch {
        setIssueError("未能确认签发结果，请先核对处罚记录再重试。");
        setIssueOutcomeUnknown(true);
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
            <label
              className="block text-sm text-[var(--color-fg-mid)]"
              htmlFor="discipline-subject-search"
            >
              搜索被处罚用户（展示昵称 / 完美昵称 / Steam 昵称 / 邮箱，至少 2 个字符）
            </label>
            <input
              id="discipline-subject-search"
              type="search"
              value={subjectQuery}
              onChange={(e) => handleSubjectQueryChange(e.target.value)}
              placeholder="输入关键字按需搜索…"
              className="w-full max-w-sm rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] outline-none focus:border-[var(--color-accent)] transition-colors"
            />
            {currentSearch?.success === false && (
              <p role="alert" className="text-sm text-[var(--color-danger)]">
                {currentSearch.error}
              </p>
            )}
            <select
              aria-label="选择被处罚用户"
              value={selectedSubject?.id ?? ""}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              disabled={subjectOptions.length === 0}
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
            <p role="status" className="text-xs text-[var(--color-fg-mid)]">
              {query.length >= MIN_QUERY_LENGTH && !currentSearch
                ? "正在搜索用户…"
                : currentSearch?.success && subjectOptions.length === 0
                  ? "没有匹配的用户。"
                  : null}
            </p>
          </div>

          <div className="space-y-2">
            <span className="block text-sm text-[var(--color-fg-mid)]">处罚效果（至少一项）</span>
            <div className="flex flex-wrap gap-3">
              {SANCTION_EFFECTS.map((effect) => (
                <label
                  key={effect}
                  className="flex items-center gap-1.5 text-sm text-[var(--color-fg)]"
                >
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
            <label
              className="block text-sm text-[var(--color-fg-mid)]"
              htmlFor="discipline-internal-evidence"
            >
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
            <label
              className="block text-sm text-[var(--color-fg-mid)]"
              htmlFor="discipline-public-explanation"
            >
              公开处罚说明
            </label>
            <textarea
              id="discipline-public-explanation"
              aria-describedby="discipline-public-explanation-help"
              value={publicExplanation}
              onChange={(e) => setPublicExplanation(e.target.value)}
              rows={2}
              maxLength={1000}
              className="w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)] transition-colors"
            />
            <p
              id="discipline-public-explanation-help"
              className="text-xs text-[var(--color-fg-mid)]"
            >
              向本人展示，并用于个人主页公示。请勿填写内部证据或敏感信息。
            </p>
          </div>

          <div className="space-y-2">
            <label
              className="block text-sm text-[var(--color-fg-mid)]"
              htmlFor="discipline-effective-until"
            >
              有效期至（北京时间，留空为长期有效）
            </label>
            <input
              id="discipline-effective-until"
              type="datetime-local"
              value={effectiveUntilInput}
              onChange={(e) => setEffectiveUntilInput(e.target.value)}
              className="max-w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)] transition-colors"
            />
          </div>

          {issueError && !preview && (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {issueError}
            </p>
          )}

          <AlertDialog
            open={preview !== null}
            onOpenChange={(open) => {
              if (open) {
                prepareIssue();
              } else if (!pending) {
                setIssuePreview(null);
                setIssueError(null);
              }
            }}
          >
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" disabled={pending}>
                核对处罚
              </Button>
            </AlertDialogTrigger>
            {preview && (
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>签发这项处罚？</AlertDialogTitle>
                  <AlertDialogDescription>
                    确认后立即在本赛事生效。请核对被处罚用户、限制和公开说明。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <dl className="space-y-3 text-sm [overflow-wrap:anywhere]">
                  <div>
                    <dt className="font-medium">被处罚用户</dt>
                    <dd>{preview.subject.label}</dd>
                    {preview.subject.detail && (
                      <dd className="text-[var(--color-fg-secondary)]">{preview.subject.detail}</dd>
                    )}
                  </div>
                  <div>
                    <dt className="font-medium">处罚效果</dt>
                    <dd>{preview.effects.map((effect) => EFFECT_LABELS[effect]).join("、")}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">有效期</dt>
                    <dd>
                      {preview.effectiveUntil
                        ? `签发起至 ${formatCST(preview.effectiveUntil)}（北京时间）`
                        : "签发起长期有效"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">公开处罚说明</dt>
                    <dd className="whitespace-pre-wrap">{preview.publicExplanation ?? "未填写"}</dd>
                  </div>
                </dl>
                {issueError && (
                  <p role="alert" className="text-sm text-[var(--color-danger)]">
                    {issueError}
                  </p>
                )}
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={pending}>返回修改</AlertDialogCancel>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => handleIssue(preview)}
                    disabled={pending || issueOutcomeUnknown}
                  >
                    {pending ? "正在签发…" : "确认签发处罚"}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            )}
          </AlertDialog>
        </Panel>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--color-fg)]">处罚记录</h2>
        <ListToolbar className="items-start" aria-label="处罚记录搜索与筛选">
          <ListSearchField
            ref={searchFieldRef}
            queryKey="q"
            label="搜索处罚记录"
            placeholder="被处罚用户姓名 / 邮箱…"
            value={searchParams.get("q") ?? ""}
            onDebouncedChange={(value) => update({ q: value })}
            className="min-w-0 w-full flex-1 basis-full lg:basis-[55%]"
          />
          <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[25%]">
            <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">状态</span>
            <select
              aria-label="处罚状态"
              value={currentStatus}
              onChange={(event) => update({ status: event.target.value })}
              className="h-9 w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm text-[var(--color-fg)]"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <ClearFilters
            defaults={DISCIPLINE_ADMIN_DEFAULTS}
            searchParams={searchParams}
            onClear={(updates) => {
              searchFieldRef.current?.reset();
              update(updates);
            }}
          />
        </ListToolbar>

        {sanctions.length === 0 ? (
          <EmptyState
            title={hasAnyRecords ? "没有符合当前筛选条件的纪律处罚" : "本赛事暂无纪律处罚记录"}
          />
        ) : (
          <div className="space-y-3">
            {sanctions.map((row) => (
              <Panel key={row.id} contentClassName="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-[var(--color-fg)]">{row.subjectLabel}</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs"
                    data-status={row.resolvedStatus}
                    style={
                      row.resolvedStatus === "active"
                        ? {
                            background: "color-mix(in srgb, var(--color-danger) 12%, transparent)",
                            color: "var(--color-danger)",
                          }
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
                <p className="text-sm text-[var(--color-fg-mid)]">
                  生效窗口：{describeWindow(row)}
                </p>
                <p className="text-sm">公开说明：{row.publicExplanation ?? "—"}</p>
                {row.internalEvidence && (
                  <p className="text-sm">
                    内部证据：
                    <span className="text-[var(--color-fg-mid)]">{row.internalEvidence}</span>
                  </p>
                )}
                {row.revocationReason && (
                  <p className="text-sm text-[var(--color-fg-mid)]">
                    撤销原因：{row.revocationReason}
                  </p>
                )}
                {rowErrors[row.id] && (
                  <p role="alert" className="text-sm text-[var(--color-danger)]">
                    {rowErrors[row.id]}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {row.resolvedStatus !== "revoked" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setRevokeTarget(revokeTarget === row.id ? null : row.id);
                        setRevokeReason("");
                      }}
                    >
                      撤销
                    </Button>
                  )}
                  {row.storedStatus === "active" && row.resolvedStatus === "expired" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleExpire(row.id)}
                      disabled={pending}
                    >
                      标记过期
                    </Button>
                  )}
                </div>
                {revokeTarget === row.id && (
                  <div className="space-y-2 rounded-sm border border-[var(--color-border)] p-3">
                    <label
                      className="block text-sm text-[var(--color-fg-mid)]"
                      htmlFor={`revoke-reason-${row.id}`}
                    >
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
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRevokeTarget(null);
                          setRevokeReason("");
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                )}
              </Panel>
            ))}
          </div>
        )}
        <div className="flex justify-between gap-3">
          <ResultSummary total={total} page={page} pageSize={pageSize} totalPages={totalPages} />
        </div>
        <PaginationControls
          page={page}
          totalPages={totalPages}
          onPageChange={(nextPage) =>
            update({ page: nextPage }, { defaults: { page: 1 }, history: "push" })
          }
        />
      </section>
    </div>
  );
}
