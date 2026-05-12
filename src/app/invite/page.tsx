import { redirect } from "next/navigation";
import { getUserSession } from "@/lib/auth/session";
import { ClaimInviteForm } from "@/components/auth/ClaimInviteForm";

interface Props {
  searchParams: Promise<{ code?: string }>;
}

export default async function InvitePage({ searchParams }: Props) {
  const { code } = await searchParams;
  const session = await getUserSession();

  if (!session) {
    const next = code ? `/invite?code=${encodeURIComponent(code)}` : "/invite";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-[var(--color-fg)]">使用邀请码</h1>
          <p className="text-sm text-[var(--color-fg-mid)]">
            输入邀请码以获取管理员权限
          </p>
        </div>
        <ClaimInviteForm initialCode={code} />
      </div>
    </main>
  );
}
