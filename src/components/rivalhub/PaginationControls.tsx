"use client";

import { cn } from "@/lib/utils/cn";
import React from "react";
import { Button } from "@/components/ui/button";

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function PaginationControls({ page, totalPages, onPageChange, className }: PaginationControlsProps) {
  if (totalPages <= 1) return null;

  const currentPage = Math.min(Math.max(page, 1), totalPages);
  return (
    <nav aria-label="列表分页" className={cn("flex items-center justify-center gap-2", className)}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label="上一页"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        上一页
      </Button>
      <span aria-current="page" className="text-xs tabular-nums text-[var(--color-fg-dim)]">
        第 {currentPage} / {totalPages} 页
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label="下一页"
        disabled={currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
      >
        下一页
      </Button>
    </nav>
  );
}
