import Link from "next/link";
import { PageLayout } from "@/components/rivalhub";
export default function StatsNotFound() {
  return <PageLayout variant="wide" className="space-y-3"><h1>重新选择范围</h1><p>请从数据中心选择公开赛事与筛选范围。</p><Link href="/stats" className="underline">返回数据中心</Link></PageLayout>;
}
