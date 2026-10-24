"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/rivalhub/ErrorState";
import { PageLayout } from "@/components/rivalhub/Layout";
import { extractErrorDigest } from "@/lib/observability/error-digest";
import { recordClientBoundaryError } from "@/lib/telemetry/client";

export default function VetoRoomError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { recordClientBoundaryError(error); }, [error]);
  return (
    <PageLayout variant="standard" role="alert">
      <ErrorState title="加载 BP 房间失败"
        sub="若刚提交过操作，请先重新读取房间核对结果，再决定下一步操作。仍无法加载时，请向管理员提供出错时间和排查编号（如有）。"
        errorDigest={extractErrorDigest(error)} onRetry={reset} retryLabel="重新读取房间" />
    </PageLayout>
  );
}
