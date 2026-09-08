import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MarkdownDocument } from "@/components/content/MarkdownDocument";

export const metadata: Metadata = { title: "赛事规则 | RivalHub", description: "NJU Major 2026 赛事规则 v1.0" };

async function getRulebook() {
  "use cache";
  return readFile(resolve(process.cwd(), "docs/rules/published/nju-major-2026-v1.md"), "utf8");
}

export default async function RulesPage() {
  const rulebook = await getRulebook();
  return <div className="mx-auto max-w-4xl space-y-5 px-4 py-12">
    <section className="space-y-2 border-b border-[var(--color-border)] pb-6"><h1 className="font-display text-3xl font-semibold">NJU Major 2026 赛事规则 v1.0</h1><p className="text-sm text-[var(--color-fg-mid)]">本届正式规则 · 2026 年 9 月 8 日发布。报名、参赛确认与比赛运营均以本规则为准。</p></section>
    <MarkdownDocument omitLeadingH1>{rulebook}</MarkdownDocument>
    <p className="text-sm text-[var(--color-fg-mid)]">需要查阅往届 Spring 规则？<Link className="underline" href="/rules/spring">打开历史规则</Link></p>
  </div>;
}
