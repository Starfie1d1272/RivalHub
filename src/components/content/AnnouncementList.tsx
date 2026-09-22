import Link from "next/link";
import { MarkdownDocument } from "@/components/content/MarkdownDocument";
import { Panel } from "@/components/rivalhub";
import type { PublicAnnouncement } from "@/lib/announcements/presentation";

export function AnnouncementList({ announcements }: { announcements: readonly PublicAnnouncement[] }) {
  if (announcements.length === 0) return <Panel><p className="text-sm text-[var(--color-fg-mid)]">暂无公开公告。</p></Panel>;
  return <div className="grid gap-4">{announcements.map((announcement) => <article key={announcement.id} className="border border-[var(--color-border)] bg-[var(--color-panel-low)] p-5"><div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-fg-dim)]"><span>{announcement.typeLabel}</span><span>·</span><span>{announcement.scopeLabel}</span><span>·</span><time dateTime={announcement.publishedAt}>{new Date(announcement.publishedAt).toLocaleString("zh-CN")}</time>{announcement.updatedAt !== announcement.publishedAt && <span>· 更新于 {new Date(announcement.updatedAt).toLocaleString("zh-CN")}</span>}</div><h2 className="mt-2 text-xl font-semibold text-[var(--color-fg)]">{announcement.title}</h2><MarkdownDocument>{announcement.body}</MarkdownDocument>{announcement.scope === "season" && announcement.season && <Link href={`/${announcement.season.slug}/announcements`} className="mt-4 inline-flex text-sm text-[var(--color-accent)] hover:underline">查看该赛事公告历史 →</Link>}</article>)}</div>;
}
