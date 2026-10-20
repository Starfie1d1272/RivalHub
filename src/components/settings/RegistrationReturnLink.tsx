import Link from "next/link";
import { safeLocalRedirect } from "@/lib/auth/redirect";
import { Button } from "@/components/ui/button";

export function RegistrationReturnLink({ href }: { href: string | string[] | undefined }) {
  const target = safeLocalRedirect(typeof href === "string" ? href : undefined, "");
  if (!/^\/[^/?#]+\/register(?:\?|$)/.test(target)) return null;
  return <div className="mb-4"><p className="mb-2 text-sm text-[var(--color-fg-mid)]">保存资料后，返回本届名单查看最新检查结果。</p><Button asChild variant="outline"><Link prefetch={false} href={target as never}>返回本届参赛名单</Link></Button></div>;
}
