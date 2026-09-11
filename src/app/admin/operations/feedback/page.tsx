import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { FeedbackManager } from "@/components/admin/FeedbackManager";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { listFeedbackForAdmin } from "@/lib/feedback/read-model";
import { feedbackCategorySchema, type FeedbackCategory, type FeedbackStatus } from "@/lib/feedback/validation";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseStatus(value: string | undefined): FeedbackStatus | undefined {
  return value === "new" || value === "triaged" || value === "resolved" ? value : undefined;
}

function parseCategory(value: string | undefined): FeedbackCategory | undefined {
  const parsed = feedbackCategorySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export default async function FeedbackAdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const admin = await resolveAdminPageAccess(requireSuperAdmin);
  if (!admin) return <AdminAccessDenied />;
  const params = await searchParams;
  const status = parseStatus(first(params.status));
  const category = parseCategory(first(params.category));
  return <PageLayout variant="wide" className="space-y-6"><PageHeader title="用户反馈" description="只允许超级管理员查看全站反馈；必要时可人工创建工程 Issue。" /><FeedbackManager rows={await listFeedbackForAdmin({ status, category })} /></PageLayout>;
}
