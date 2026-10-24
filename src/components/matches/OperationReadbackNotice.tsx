"use client";
import type { ReactNode } from "react";
import { readbackSummary } from "@/lib/matches/operation-readback";

export function OperationReadbackNotice({ matches, version, children }: { matches: boolean; version: string; children?: ReactNode }) {
  return <div role="status" className="space-y-1 rounded border p-2 text-xs">
    <p>{readbackSummary(matches, version)}</p>{children}
  </div>;
}
