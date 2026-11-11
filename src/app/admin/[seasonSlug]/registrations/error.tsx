"use client";

import { ErrorState } from "@/components/rivalhub/ErrorState";
import { PageLayout } from "@/components/rivalhub/Layout";
import { extractErrorDigest } from "@/lib/observability/error-digest";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <PageLayout variant="workbench" role="alert">
      <ErrorState
        title="加载报名审核失败"
        sub="请重新加载。刚提交过审核时，先确认当前状态再决定是否重试。"
        errorDigest={extractErrorDigest(error)}
        onRetry={retry}
        retryLabel="重新加载"
      />
    </PageLayout>
  );
}
