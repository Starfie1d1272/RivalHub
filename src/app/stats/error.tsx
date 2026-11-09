"use client";

import { ErrorState } from "@/components/rivalhub/ErrorState";
import { PageLayout } from "@/components/rivalhub/Layout";
import { extractErrorDigest } from "@/lib/observability/error-digest";

export default function StatsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PageLayout variant="workbench" role="alert">
      <ErrorState
        title="加载统计数据失败"
        sub="请重新加载统计。若问题持续，可向管理员提供下方的排查编号。"
        errorDigest={extractErrorDigest(error)}
        onRetry={reset}
        retryLabel="重新加载"
      />
    </PageLayout>
  );
}
