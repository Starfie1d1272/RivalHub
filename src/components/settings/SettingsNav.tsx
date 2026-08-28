"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

const items = [
  { href: "/settings", label: "参赛资料", description: "展示昵称、Steam64、完美平台 ID 与 QQ" },
  { href: "/settings/education", label: "教育身份", description: "高校邮箱、学信网材料与审核记录" },
  { href: "/settings/competitive", label: "竞技档案", description: "历史、上一赛季与当前赛季最高段位" },
  { href: "/settings/password", label: "账号与安全", description: "密码与登录安全" },
  { href: "/settings/privacy", label: "隐私", description: "公开资料与仅供审核使用的资料范围" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return <nav aria-label="参赛资料导航" className="flex overflow-x-auto border border-[var(--color-border)] lg:block lg:overflow-visible">
    {items.map((item) => {
      const active = pathname === item.href;
      return <Link key={item.href} href={item.href} className={cn(
        "min-w-28 shrink-0 border-r border-[var(--color-border)] px-3 py-2.5 last:border-r-0 lg:block lg:min-w-0 lg:border-r-0 lg:border-b lg:last:border-b-0",
        active ? "bg-[var(--color-panel-hi)] text-[var(--color-accent)]" : "hover:bg-[var(--color-panel-hi)]",
      )}>
        <span className="block text-sm font-medium">{item.label}</span>
        <span className="mt-1 hidden font-mono text-[11px] leading-4 text-[var(--color-fg-mid)] lg:block">{item.description}</span>
      </Link>;
    })}
  </nav>;
}
