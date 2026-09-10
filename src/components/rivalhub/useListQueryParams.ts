"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { applyListQueryUpdates, type ListQueryParamsOptions, type ListQueryUpdates, type ListQueryUpdateOptions } from "@/lib/list-query";
export { applyListQueryUpdates } from "@/lib/list-query";
export type { ListQueryValue, ListQueryUpdates, ListQueryDefaults, ListQuerySearchParams, ListQueryUpdateOptions, ListQueryUpdate, ListQueryParamsOptions } from "@/lib/list-query";

export function useListQueryParams({ routeBase, defaults = {} }: ListQueryParamsOptions = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const latestSearchParamsRef = useRef(new URLSearchParams(searchParams.toString()));
  useEffect(() => {
    latestSearchParamsRef.current = new URLSearchParams(searchParams.toString());
  }, [searchParams]);

  const update = useCallback(
    (updates: ListQueryUpdates, options: ListQueryUpdateOptions = {}) => {
      const next = applyListQueryUpdates(latestSearchParamsRef.current, updates, {
        defaults: { ...defaults, ...options.defaults },
      });
      latestSearchParamsRef.current = next;
      const base = routeBase ?? pathname ?? "/";
      const query = next.toString();
      const href = query ? `${base}?${query}` : base;
      const navigate = options.history === "push" ? router.push : router.replace;
      navigate(href as never);
    },
    [defaults, pathname, routeBase, router],
  );

  return { searchParams, update };
}
