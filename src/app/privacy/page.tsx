import Link from "next/link";
import { Marker } from "@/components/rivalhub";
import { PrivacyContent } from "@/components/settings/PrivacyContent";

export default function PrivacyPage() {
  return <main className="container mx-auto max-w-3xl space-y-6 px-4 py-10"><Marker sub="NJU Major · 2026 年 8 月修订版">隐私与数据使用说明</Marker><PrivacyContent /><Link className="inline-block text-sm underline" href="/">返回首页</Link></main>;
}
