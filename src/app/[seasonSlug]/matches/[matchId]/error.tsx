"use client";

import { ErrorState } from "@/components/rivalhub/ErrorState";
import { PageLayout } from "@/components/rivalhub/Layout";
import { extractErrorDigest } from "@/lib/observability/error-digest";

export default function MatchDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PageLayout variant="wide" role="alert">
      <ErrorState
        title="加载比赛详情失败"
        sub="请重新加载页面。若刚提交过操作，请先确认操作结果，再决定是否重新提交；仍无法加载时，请向管理员提供页面地址、出错时间和排查编号（如有）。"
        errorDigest={extractErrorDigest(error)}
        onRetry={reset}
        retryLabel="重新加载"
      />
    </PageLayout>
  );
}
