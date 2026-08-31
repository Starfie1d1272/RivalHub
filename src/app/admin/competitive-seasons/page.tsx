import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/session";
import { db } from "@/db/client";
import { loadCompetitivePlatformCatalog } from "@/lib/competitive/catalog";
import { CompetitivePlatformCatalog } from "@/components/admin/CompetitivePlatformCatalog";

export default async function CompetitiveSeasonsAdminPage() {
  try { await requireSuperAdmin(); } catch { redirect("/login"); }
  const platforms = await loadCompetitivePlatformCatalog(db);
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-6 py-8">
      <div>
        <p className="font-mono text-[11px] tracking-[0.18em] text-[var(--color-accent)]">ADMINISTRATION</p>
        <h1 className="mt-1 text-3xl font-semibold">竞技平台目录</h1>
        <p className="mt-2 text-sm text-[var(--color-fg-mid)]">平台长期拥有段位表与赛季时间目录；赛事只在发布时引用并冻结当时的目录上下文，之后的目录变化不影响已发布赛事。</p>
      </div>
      <CompetitivePlatformCatalog platforms={platforms} />
    </div>
  );
}
