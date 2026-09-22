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
  const [searching, startSearch] = useTransition();

  function search() {
    startSearch(async () => {
      const result = await getInstitutionSearch(query);
      if (result.success) {
        setResults(result.data);
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function selectInstitution(institution: EducationInstitutionOption) {
    onChange(institution);
    setQuery(institution.name);
    setResults([]);
  }

  function reset() {
    onChange(null);
    setResults([]);
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
        <Input id={`${idPrefix}-search`} aria-describedby={`${idPrefix}-search-hint`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：你的学校名称" disabled={disabled} />
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
    </div>
  );
}
