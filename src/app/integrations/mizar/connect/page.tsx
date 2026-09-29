import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { mizarPairingIntents, seasons, users } from "@/db/schema";
import { getCurrentUserAuthorization, getUserSession } from "@/lib/auth/session";
import { authorizeMizarPairingAction } from "./actions";

export const instant = false;

export default async function MizarConnectPage({ searchParams }: { searchParams: Promise<{ pairingId?: string; authorized?: string }> }) {
  const params = await searchParams;
  const pairingId = params.pairingId?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(pairingId)) return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-semibold">连接 Mizar</h1><p className="mt-4 text-[var(--color-fg-mid)]">连接请求无效，请回到 Mizar 重新发起连接。</p></main>;
  const session = await getUserSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/integrations/mizar/connect?pairingId=${pairingId}`)}`);
  if (params.authorized === "1") {
    return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-semibold">Mizar 已授权</h1><p className="mt-4 text-[var(--color-fg-mid)]">可以回到 Mizar；它会自动完成连接并读取该赛事赛程。</p></main>;
  }
  const [intent] = await db.select({
    status: mizarPairingIntents.status,
    isExpired: sql<boolean>`${mizarPairingIntents.expiresAt} <= NOW()`,
  }).from(mizarPairingIntents).where(eq(mizarPairingIntents.id, pairingId));
  if (!intent || intent.isExpired || intent.status === "expired") return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-semibold">连接请求已过期</h1><p className="mt-4 text-[var(--color-fg-mid)]">请回到 Mizar 重新发起连接。</p></main>;
  if (intent.status === "authorized") return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-semibold">连接请求已处理</h1><p className="mt-4 text-[var(--color-fg-mid)]">可以回到 Mizar；它会自动完成连接。</p></main>;
  const authorization = await getCurrentUserAuthorization();
  const allowedSeasons = authorization?.role === "super_admin"
    ? await db.select({ id: seasons.id, name: seasons.name }).from(seasons).orderBy(asc(seasons.name))
    : authorization?.seasonIds.length
      ? await db.select({ id: seasons.id, name: seasons.name }).from(seasons).where(inArray(seasons.id, authorization.seasonIds)).orderBy(asc(seasons.name))
      : [];
  const [user] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, session.userId));
  return <main className="mx-auto max-w-xl p-8">
    <h1 className="text-2xl font-semibold">连接 Mizar</h1>
    <p className="mt-4 text-sm text-[var(--color-fg-mid)]">以 {user?.displayName?.trim() || "未设置显示名的管理员"} 的身份授权 Mizar 读取所选赛事赛程，并提交该赛事的实时制播数据。授权后可在赛事管理页撤销连接。</p>
    {allowedSeasons.length ? <form action={authorizeMizarPairingAction} className="mt-6 space-y-4">
      <input type="hidden" name="pairingId" value={pairingId} />
      <label className="block text-sm font-medium" htmlFor="mizar-competition">授权赛事</label>
      <select id="mizar-competition" name="competitionId" required defaultValue={allowedSeasons.length === 1 ? allowedSeasons[0].id : ""} className="w-full rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-sm">
        {allowedSeasons.length > 1 && <option value="" disabled>选择赛事</option>}
        {allowedSeasons.map(season => <option key={season.id} value={season.id}>{season.name}</option>)}
      </select>
      <button type="submit" className="rounded-sm bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-fg)]">授权 Mizar</button>
    </form> : <p className="mt-6 text-[var(--color-danger)]">当前账号没有可授权的赛事管理员权限。</p>}
    <Link className="mt-6 inline-block text-sm underline" href="/">返回首页</Link>
  </main>;
}
