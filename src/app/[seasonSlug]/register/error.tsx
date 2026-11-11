"use client";

import { ErrorState } from "@/components/rivalhub/ErrorState";
import { PageLayout } from "@/components/rivalhub/Layout";
import { extractErrorDigest } from "@/lib/observability/error-digest";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <PageLayout variant="wide" role="alert">
      <ErrorState
        title="加载报名失败"
        sub="请重新加载并查看当前报名状态，再继续填写或提交。"
        errorDigest={extractErrorDigest(error)}
        onRetry={reset}
        retryLabel="重新加载"
      />
    </PageLayout>
  );
}
