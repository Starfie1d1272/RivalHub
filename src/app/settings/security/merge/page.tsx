import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { PageHeader, Panel, StatusBanner } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { UserMergeConfirmation } from "@/components/settings/UserMergeConfirmation";
import { getUserSession } from "@/lib/auth/session";
import { buildUserMergePreflight, type UserMergeCategory } from "@/lib/identity/merge";
import { loadSelfServiceMergeAuthorization, selectSelfServiceMergePair } from "@/lib/identity/self-service";

const CATEGORIES: readonly UserMergeCategory[] = ["BLOCKER", "AUTOMATIC", "PRESERVE"];
const CATEGORY_HELP: Record<UserMergeCategory, string> = {
  BLOCKER: "需要先处理的身份或赛事冲突",
  AUTOMATIC: "确认后由系统按固定规则处理",
  PRESERVE: "保留原始历史、执行人或冻结事实",
};

export default async function UserMergePage({
  searchParams,
}: {
  searchParams: Promise<{ authorization?: string; canonical?: string }>;
}) {
  const session = await getUserSession();
  if (!session) redirect("/login?next=/settings/security");
  const params = await searchParams;
  if (!params.authorization) redirect("/settings/security");

  let authorization;
  try {
    authorization = await loadSelfServiceMergeAuthorization(db, {
      authorizationId: params.authorization,
      actorUserId: session.userId,
    });
  } catch {
    return <div className="max-w-3xl space-y-5">
      <PageHeader title="账号归并" description="这次双方身份控制授权不可用。" />
      <StatusBanner tone="warn" title="授权已失效" sub="请返回账号与安全，重新添加并验证属于另一个账号的邮箱。" />
      <Button asChild variant="outline"><Link href="/settings/security">返回账号与安全</Link></Button>
    </div>;
  }

  const canonicalUserId = params.canonical && authorization.accounts.some((account) => account.id === params.canonical)
    ? params.canonical
    : authorization.initiatingUserId;
  const pair = selectSelfServiceMergePair(authorization, canonicalUserId);
  const preflight = await buildUserMergePreflight(db, pair);
  const canonical = authorization.accounts.find((account) => account.id === pair.canonicalUserId)!;
  const merged = authorization.accounts.find((account) => account.id === pair.mergedUserId)!;

  return <div className="max-w-3xl space-y-6">
    <PageHeader title="账号归并" description="你已经证明控制两个账号。请选择要长期保留的账号，并核对归并影响。" />

    <Panel label="选择要保留的账号" contentClassName="p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {authorization.accounts.map((account) => {
          const selected = account.id === pair.canonicalUserId;
          return <Link key={account.id} href={{ pathname: "/settings/security/merge", query: { authorization: authorization.id, canonical: account.id } }} aria-current={selected ? "true" : undefined} className={`rounded-sm border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${selected ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border)] hover:bg-[var(--color-panel-hi)]"}`}>
            <p className="font-semibold">{account.label}</p>
            <p className="mt-1 break-all text-xs text-[var(--color-fg-mid)]">{account.email}</p>
            {account.teamName && <p className="mt-2 text-xs text-[var(--color-fg-mid)]">当前队伍 · {account.teamName}</p>}
            {account.steam64 && <p className="mt-1 font-mono text-[11px] text-[var(--color-fg-dim)]">Steam64 · {account.steam64}</p>}
            <p className="mt-3 text-xs font-medium">{selected ? "当前选择 · 保留此账号" : "选择保留此账号"}</p>
          </Link>;
        })}
      </div>
      <p className="mt-4 text-xs leading-5 text-[var(--color-fg-mid)]">当前方案：保留 {canonical.email}，将 {merged.email} 标记为已归并账号。保留账号的资料和竞技资料不会被另一账号覆盖。</p>
    </Panel>

    <StatusBanner
      tone={preflight.executable ? "success" : "warn"}
      title={preflight.executable ? "可以安全归并" : "暂时不能归并"}
      sub={preflight.executable ? "系统会在最终确认时再次锁定账号并核对最新数据。" : "请先处理下方标记的冲突；系统不会执行部分归并。"}
    />

    <div className="grid gap-4">
      {CATEGORIES.map((category) => {
        const items = preflight.items.filter((entry) => entry.category === category);
        return <Panel key={category} label={`${category === "BLOCKER" ? "需要处理" : category === "AUTOMATIC" ? "自动处理" : "保留历史"} · ${preflight.summary[category]}`} contentClassName="p-0">
          <p className="border-b border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-fg-mid)]">{CATEGORY_HELP[category]}</p>
          {items.length === 0
            ? <p className="px-4 py-3 text-sm text-[var(--color-fg-dim)]">本次未发现此类事实。</p>
            : <ul className="divide-y divide-[var(--color-border)]">{items.map((entry) => <li key={entry.key} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{entry.domain}</p>
                <span className={`text-[11px] ${entry.status === "blocked" ? "text-[var(--color-danger)]" : "text-[var(--color-fg-mid)]"}`}>{entry.count} 条 · {entry.status === "blocked" ? "需要处理" : entry.status === "automatic" ? "自动" : "保留"}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-[var(--color-fg-mid)]">{entry.detail}</p>
            </li>)}</ul>}
        </Panel>;
      })}
    </div>

    <Panel label="最终确认" contentClassName="p-5">
      <UserMergeConfirmation
        authorizationId={authorization.id}
        canonicalUserId={pair.canonicalUserId}
        fingerprint={preflight.fingerprint}
        executable={preflight.executable}
      />
    </Panel>
  </div>;
}
