import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUserAuthorization, getUserSession } from "@/lib/auth/session";
import { authorizeDakPairingAction } from "./actions";

export const instant = false;

export default async function DakConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ pairingId?: string; authorized?: string }>;
}) {
  const params = await searchParams;
  const pairingId = params.pairingId?.trim() ?? "";
  if (!pairingId) return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-semibold">连接 DAK Studio</h1><p className="mt-4 text-[var(--color-fg-mid)]">缺少连接请求，请回到 DAK Studio 重新发起连接。</p></main>;
  if (params.authorized === "1") {
    return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-semibold">DAK Studio 已授权</h1><p className="mt-4 text-[var(--color-fg-mid)]">可以回到 DAK Studio；它会自动完成连接并读取已授权赛事。</p></main>;
  }

  const session = await getUserSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/integrations/dak/connect?pairingId=${pairingId}`)}`);
  const authorization = await getCurrentUserAuthorization();
  const canAuthorize = authorization != null && (authorization.role === "super_admin" || authorization.seasonIds.length > 0);

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">连接 DAK Studio</h1>
      <p className="mt-4 text-[var(--color-fg-mid)]">DAK Studio 将获得当前账号已授权赛事的最小集成权限：读取赛事、提交 Demo 证据、读取 Demo 状态。</p>
      {canAuthorize ? (
        <form action={authorizeDakPairingAction} className="mt-6 space-y-4">
          <input type="hidden" name="pairingId" value={pairingId} />
          <button type="submit" className="rounded-sm bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-fg)]">授权此 DAK Studio 设备</button>
        </form>
      ) : (
        <p className="mt-6 text-[var(--color-danger)]">当前账号没有赛事管理员权限，不能建立 DAK 连接。</p>
      )}
      <Link className="mt-6 inline-block text-sm underline" href="/settings">返回设置</Link>
    </main>
  );
}
