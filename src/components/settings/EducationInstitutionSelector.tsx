"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { getInstitutionSearch } from "@/actions/education-verifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type EducationInstitutionOption = { id: string; name: string; code: string | null; province: string | null };

interface EducationInstitutionSelectorProps {
  idPrefix: string;
  value: EducationInstitutionOption | null;
  onChange: (value: EducationInstitutionOption | null) => void;
  disabled?: boolean;
}

/** Narrow shared canonical-institution selector for CHSI and manual flows. */
export function EducationInstitutionSelector({ idPrefix, value, onChange, disabled = false }: EducationInstitutionSelectorProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EducationInstitutionOption[]>([]);
  const [searched, setSearched] = useState(false);
  const [recoveryExpanded, setRecoveryExpanded] = useState(false);
  const [searching, startSearch] = useTransition();

  function search() {
    startSearch(async () => {
      const result = await getInstitutionSearch(query);
      if (result.success) {
        setResults(result.data);
        setSearched(true);
        if (result.data.length > 0) setRecoveryExpanded(false);
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function selectInstitution(institution: EducationInstitutionOption) {
    onChange(institution);
    setQuery(institution.name);
    setResults([]);
    setSearched(false);
    setRecoveryExpanded(false);
  }

  function reset() {
    onChange(null);
    setResults([]);
    setSearched(false);
    setRecoveryExpanded(false);
  }

  return value ? (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-search`}>学校</Label>
          <p className="text-xs text-[var(--color-fg-mid)]">已从教育部高校目录选择</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={reset}>重新选择</Button>
      </div>
      <div role="status" aria-live="polite" className="flex items-start gap-2 rounded-sm border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3 py-3">
        <span aria-hidden className="mt-0.5 font-mono text-sm font-bold text-[var(--color-accent)]">✓</span>
        <div className="min-w-0">
          <p className="font-semibold text-[var(--color-fg)]">{value.name}</p>
          <p className="mt-0.5 text-xs text-[var(--color-fg-mid)]">{value.province ?? "地区未提供"}{value.code ? ` · 高校代码 ${value.code}` : ""}</p>
        </div>
      </div>
    </div>
  ) : (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-search`}>学校</Label>
        <p id={`${idPrefix}-search-hint`} className="text-xs leading-5 text-[var(--color-fg-mid)]">输入学校名称，并从教育部高校目录搜索结果中选择</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input id={`${idPrefix}-search`} aria-describedby={`${idPrefix}-search-hint`} value={query} onChange={(event) => { setQuery(event.target.value); setSearched(false); setRecoveryExpanded(false); }} placeholder="例如：你的学校名称" disabled={disabled} />
        <Button type="button" variant={query.trim() ? "default" : "outline"} disabled={disabled || searching || !query.trim()} onClick={search}>{searching ? "搜索中…" : "搜索高校"}</Button>
      </div>
      {results.length > 0 && <div className="overflow-hidden rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)]">
        <p className="border-b border-[var(--color-border)] px-3 py-2 font-mono text-[11px] text-[var(--color-fg-mid)]">请选择搜索结果中的学校</p>
        <div className="max-h-56 overflow-auto divide-y divide-[var(--color-border)]">
          {results.map((institution) => <Button type="button" key={institution.id} variant="ghost" onClick={() => selectInstitution(institution)} className="h-auto w-full justify-start rounded-none px-3 py-2.5 text-left hover:bg-[var(--color-panel-hi)] focus-visible:bg-[var(--color-panel-hi)]">
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate font-semibold text-[var(--color-fg)]">{institution.name}</span>
              <span className="text-xs font-normal text-[var(--color-fg-mid)]">{institution.province ?? "地区未提供"}{institution.code ? ` · 高校代码 ${institution.code}` : ""}</span>
            </span>
          </Button>)}
        </div>
      </div>}
      {searched && results.length === 0 && query.trim() && <div role="status" className="space-y-3 rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] p-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-[var(--color-fg)]">未找到学校</p>
          <p className="text-sm leading-6 text-[var(--color-fg-mid)]">请优先按学信网报告中的“学校名称”搜索；教学点、学习中心或分校名称可能不作为独立高校收录。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={searching} onClick={search}>重新搜索</Button>
          <Button type="button" size="sm" variant="ghost" aria-expanded={recoveryExpanded} onClick={() => setRecoveryExpanded((current) => !current)}>仍找不到学校</Button>
        </div>
        {recoveryExpanded && <div className="space-y-1 border-l-2 border-[var(--color-accent)] pl-3 text-sm leading-6 text-[var(--color-fg-mid)]">
          <p>请把上方名称改为学信网报告或正式学籍材料上的学校全称，再搜索一次。</p>
          <p>仍无结果时，请将该正式学校名称发给赛事管理员补充院校目录。目录补充完成后即可重新搜索并选择；上方自由文本不会直接成为教育认证学校。</p>
        </div>}
      </div>}
    </div>
  );
}
