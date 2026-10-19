"use client";
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";

export function AdminMatchStageTabs({ value, children }: { value: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  return <Tabs value={value} onValueChange={(stage) => {
    const query = new URLSearchParams(search.toString());
    query.set("stage", stage);
    router.replace(`${pathname}?${query}` as never, { scroll: false });
  }}>{children}</Tabs>;
}
