import React from "react";

interface ResultSummaryProps {
  total: number;
  page: number;
  pageSize: number;
  totalPages?: number;
  className?: string;
}

export function ResultSummary({ total, page, pageSize, totalPages, className }: ResultSummaryProps) {
  const pages = totalPages ?? Math.ceil(total / pageSize);
  return (
    <p className={`text-xs tabular-nums text-[var(--color-fg-dim)]${className ? ` ${className}` : ""}`}>
      共 {total} 条{pages > 1 ? ` · 第 ${page} / ${pages} 页` : ""}
    </p>
  );
}
