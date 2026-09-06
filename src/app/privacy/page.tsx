import Link from "next/link";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { PrivacyContent } from "@/components/settings/PrivacyContent";

export default function PrivacyPage() {
  return <PageLayout as="div" variant="narrow" className="space-y-6"><PageHeader title="隐私与数据使用说明" eyebrow="NJU Major · 2026 年 8 月修订版" /><PrivacyContent /><Link className="inline-block text-sm underline" href="/">返回首页</Link></PageLayout>;
}
