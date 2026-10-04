import Link from "next/link";
import { PageLayout } from "@/components/rivalhub";
export default function StatsNotFound() {
  return <PageLayout variant="wide" className="space-y-3"><h1>统计范围不可用</h1><p>赛事或筛选范围不存在或尚未公开。</p><Link href="/stats" className="underline">返回数据中心</Link></PageLayout>;
}
