"use client";

import "./globals.css";
import { ErrorState } from "@/components/rivalhub/ErrorState";
import { PageLayout } from "@/components/rivalhub/Layout";
import { extractErrorDigest } from "@/lib/observability/error-digest";

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="zh-CN" className="dark">
      <body>
        <PageLayout variant="wide" role="alert">
          <ErrorState
            title="RivalHub 暂时无法加载"
            errorDigest={extractErrorDigest(error)}
            onRetry={retry}
            retryLabel="重新加载"
          />
        </PageLayout>
      </body>
    </html>
  );
}
