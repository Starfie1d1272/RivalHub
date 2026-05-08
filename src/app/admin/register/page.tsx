import { AdminRegisterForm } from "@/components/admin/AdminRegisterForm";

interface PageProps {
  searchParams: Promise<{ invite?: string }>;
}

export default async function AdminRegisterPage({ searchParams }: PageProps) {
  const { invite } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            管理员注册
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            使用赛委会发放的邀请码注册管理员账户
          </p>
        </div>
        <AdminRegisterForm defaultInvite={invite} />
      </div>
    </div>
  );
}
