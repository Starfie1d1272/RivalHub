"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef } from "react";
import { Btn } from "@/components/rivalhub";

const FILTERS = [
  { key: "all",          label: "全部" },
  { key: "participated", label: "参赛过" },
  { key: "none",         label: "仅注册" },
] as const;

export function UserSearchBar({ q, filter }: { q: string; filter: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", "users");
      for (const [k, v] of Object.entries(updates)) {
        if (v) params.set(k, v);
        else params.delete(k);
      }
      router.replace(`/admin/users?${params.toString()}`);
    },
    [router, searchParams],
  );

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => push({ q: e.target.value }), 300);
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        defaultValue={q}
        onChange={handleSearch}
        placeholder="搜索名字 / 邮箱…"
        className="w-full max-w-sm rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-dim)] outline-none focus:border-[var(--color-accent)] transition-colors"
      />
      <div className="flex gap-1">
        {FILTERS.map(({ key, label }) => (
          <Btn key={key} small ghost={filter !== key} onClick={() => push({ filter: key })}>
            {label}
          </Btn>
        ))}
      </div>
    </div>
  );
}
