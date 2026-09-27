import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MarkdownDocument } from "@/components/content/MarkdownDocument";
import { PageLayout } from "@/components/rivalhub";

export const metadata: Metadata = { title: "赛事规则 | RivalHub", description: "NJU Major 赛事规则 v1.1" };

async function getRulebook() {
  "use cache";
  return readFile(resolve(process.cwd(), "docs/rules/published/nju-major-v1.1.md"), "utf8");
}

export default async function RulesPage() {
  const rulebook = await getRulebook();
  return <PageLayout variant="standard"><div className="mx-auto max-w-4xl space-y-5">
    <section className="space-y-2 border-b border-[var(--color-border)] pb-6"><h1 className="font-display text-3xl font-semibold">NJU Major 赛事规则 v1.1</h1><p className="text-sm text-[var(--color-fg-mid)]">统一赛事规则 · 2026 年 9 月 27 日发布。各届具体赛制、地图池、赛程和名单截止时间以正式赛事公告为准。</p></section>
    <MarkdownDocument omitLeadingH1>{rulebook}</MarkdownDocument>
    <p className="text-sm text-[var(--color-fg-mid)]">需要查阅往届 Spring 规则？<Link className="underline" href="/rules/spring">打开历史规则</Link></p>
  </div></PageLayout>;
}
