import { Suspense } from "react";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { AnnouncementList } from "@/components/content/AnnouncementList";
import { listAllPublicAnnouncements } from "@/lib/announcements/read-model";
import { connection } from "next/server";

export default function AnnouncementsPage() {
  return <Suspense fallback={<PageLayout variant="standard"><PageHeader title="公告" description="正在读取公开公告。" /></PageLayout>}><AnnouncementsContent /></Suspense>;
}

async function AnnouncementsContent() {
  await connection();
  return <PageLayout variant="standard" className="space-y-6"><PageHeader title="公告" description="RivalHub 的公开公告历史。" /><AnnouncementList announcements={await listAllPublicAnnouncements()} /></PageLayout>;
}
