import Link from "next/link";
export default function StatsNotFound() {
  return <div className="mx-auto max-w-7xl space-y-3 px-4 py-8"><h1>统计范围不可用</h1><p>赛事或筛选范围不存在或尚未公开。</p><Link href="/stats" className="underline">返回数据中心</Link></div>;
}
