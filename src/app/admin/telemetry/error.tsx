"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { recordClientBoundaryError } from "@/lib/telemetry/client";

export default function TelemetryError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { recordClientBoundaryError(error); }, [error]);
  return <section role="alert" className="space-y-4 p-6">
    <h1 className="text-lg font-semibold">遥测分析暂时无法显示</h1>
    <p>请重新读取分析；其他后台工作区仍可使用。</p>
    <Button onClick={retry}>重新读取</Button>
  </section>;
}
