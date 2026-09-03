import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MarkdownDocument } from "@/components/content/MarkdownDocument";

export const metadata: Metadata = { title: "赛事规则 | RivalHub", description: "当前 Major 官方赛事规则" };

async function getRulebook() {
  "use cache";
  return readFile(resolve(process.cwd(), "docs/rules/nju-major.md"), "utf8");
}

export default async function RulesPage() {
  const rulebook = await getRulebook();
  return <div className="mx-auto max-w-4xl space-y-5 px-4 py-12">
    <section className="space-y-2 border-b border-[var(--color-border)] pb-6"><h1 className="font-display text-3xl font-semibold">NJU Major 赛事规则</h1><p className="text-sm text-[var(--color-fg-mid)]">当前权威规则。报名、确认加入与比赛运营均以本规则为准。</p></section>
    <MarkdownDocument omitLeadingH1>{rulebook}</MarkdownDocument>
    <p className="text-sm text-[var(--color-fg-mid)]">需要查阅往届 Spring 规则？<Link className="underline" href="/rules/spring">打开历史规则</Link></p>
  </div>;
}
