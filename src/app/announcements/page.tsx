import { Suspense } from "react";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { AnnouncementList } from "@/components/content/AnnouncementList";
import { getPublicAnnouncementPage } from "@/lib/announcements/read-model";
import Link from "next/link";
import { io } from "next/cache";

export default function AnnouncementsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  return <Suspense fallback={<PageLayout variant="standard"><PageHeader title="公告" description="正在读取公开公告。" /></PageLayout>}><AnnouncementsContent searchParams={searchParams} /></Suspense>;
}

async function AnnouncementsContent({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await io();
  const history = await getPublicAnnouncementPage(undefined, Number((await searchParams).page));
  return <PageLayout variant="standard" className="space-y-6"><PageHeader title="公告" description="RivalHub 的公开公告历史。" /><AnnouncementList announcements={history.announcements} /><nav aria-label="公告分页" className="flex gap-4">{history.page > 1 && <Link href={`/announcements?page=${history.page - 1}`}>上一页</Link>}{history.hasNext && <Link href={`/announcements?page=${history.page + 1}`}>下一页</Link>}</nav></PageLayout>;
}
