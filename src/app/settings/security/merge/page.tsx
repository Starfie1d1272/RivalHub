import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { PageHeader, Panel, StatusBanner } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { UserMergeConfirmation } from "@/components/settings/UserMergeConfirmation";
import { getUserSession } from "@/lib/auth/session";
import { buildUserMergePreflight, type UserMergeCategory } from "@/lib/identity/merge";
import { loadSelfServiceMergeAuthorization, selectSelfServiceMergePair } from "@/lib/identity/self-service";

const CATEGORIES: readonly UserMergeCategory[] = ["REPARENT", "DEDUPE", "RECONCILE", "BLOCKER", "PRESERVE"];
const CATEGORY_HELP: Record<UserMergeCategory, string> = {
  REPARENT: "安全归到 canonical person 的事实",
  DEDUPE: "可证明等价、只保留一份的事实",
  RECONCILE: "必须先明确取值的长期资料",
  BLOCKER: "会破坏 domain invariant 的冲突",
  PRESERVE: "保持原 account identity 的历史或冻结事实",
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
      <PageHeader title="账号归并" description="这次双重 identity 控制授权不可用。" />
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
    <PageHeader title="账号归并" description="你已经证明控制两个账号的 verified identity。先选择长期保留的 canonical 用户，再核对 deterministic preflight。" />

    <Panel label="选择 canonical user" contentClassName="p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {authorization.accounts.map((account) => {
          const selected = account.id === pair.canonicalUserId;
          return <Link key={account.id} href={{ pathname: "/settings/security/merge", query: { authorization: authorization.id, canonical: account.id } }} aria-current={selected ? "true" : undefined} className={`rounded-sm border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${selected ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]" : "border-[var(--color-border)] hover:bg-[var(--color-panel-hi)]"}`}>
            <p className="font-semibold">{account.label}</p>
            <p className="mt-1 break-all text-xs text-[var(--color-fg-mid)]">{account.email}</p>
            <p className="mt-3 font-mono text-[11px]">{selected ? "CANONICAL · 保留" : "点击选择为 canonical"}</p>
          </Link>;
        })}
      </div>
      <p className="mt-4 text-xs leading-5 text-[var(--color-fg-mid)]">当前方案：保留 {canonical.email}，将 {merged.email} 归并为可追溯 alias。选择只决定哪个账号成为 canonical，不会绕过任何冲突检查。</p>
    </Panel>

    <StatusBanner
      tone={preflight.executable ? "success" : "warn"}
      title={preflight.executable ? "Preflight 可执行" : "Preflight 已 fail closed"}
      sub={preflight.executable ? "所有已发现事实均有确定性处理语义；确认时仍会在事务锁内重新生成并校验 fingerprint。" : "存在 RECONCILE 或 BLOCKER。系统不会执行部分归并，请先在对应业务流程消除冲突。"}
    />

    <div className="grid gap-4">
      {CATEGORIES.map((category) => {
        const items = preflight.items.filter((entry) => entry.category === category);
        return <Panel key={category} label={`${category} · ${preflight.summary[category]}`} contentClassName="p-0">
          <p className="border-b border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-fg-mid)]">{CATEGORY_HELP[category]}</p>
          {items.length === 0
            ? <p className="px-4 py-3 text-sm text-[var(--color-fg-dim)]">本次未发现此类事实。</p>
            : <ul className="divide-y divide-[var(--color-border)]">{items.map((entry) => <li key={entry.key} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{entry.domain}</p>
                <span className={`font-mono text-[11px] ${entry.status === "unresolved" ? "text-[var(--color-danger)]" : "text-[var(--color-fg-mid)]"}`}>{entry.count} · {entry.status.toUpperCase()}</span>
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
