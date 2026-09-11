import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { requireSuperAdmin } from "@/lib/auth/session";
import { loadConversionPolicyAdminRows } from "@/lib/competitive/conversion-policy-admin";
import { db } from "@/db/client";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { ConversionPolicyManager } from "@/components/admin/ConversionPolicyManager";
import { PageHeader, PageLayout, Section } from "@/components/rivalhub";

export default async function ConversionPoliciesAdminPage() {
  if (!(await resolveAdminPageAccess(requireSuperAdmin))) return <AdminAccessDenied />;
  const policies = await loadConversionPolicyAdminRows(db);
  return (
    <PageLayout variant="wide" className="space-y-8">
      <PageHeader
        eyebrow="竞技平台 / 段位换算"
        title="跨平台换算策略"
        description="运营 5E → Perfect World 的版本化等效换算规则。赛事在发布与开放报名时锁定规则事实；切换当前版本不会重解释已经冻结的赛事。"
      />
      <Section>
        <ConversionPolicyManager initialPolicies={policies} />
      </Section>
    </PageLayout>
  );
}
