"use client";

import React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export interface AdminPlayerContactProps {
  email?: string | null;
  qq?: string | null;
  steam64?: string | null;
  steamProfileUrl?: string | null;
}

export function AdminPlayerContact({ email, qq, steam64, steamProfileUrl }: AdminPlayerContactProps) {
  const contacts = [
    { label: "邮箱", value: email },
    { label: "QQ", value: qq },
    { label: "Steam64", value: steam64 },
  ].filter((contact): contact is { label: string; value: string } => Boolean(contact.value?.trim()));
  const hasContact = contacts.length > 0 || Boolean(steamProfileUrl);

  async function copyValue(label: string, value: string) {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value);
      toast.success(`${label} 已复制`);
    } catch {
      toast.error(`无法复制 ${label}，请手动复制`);
    }
  }

  return (
    <details className="min-w-0">
      <summary className="inline-flex cursor-pointer list-none rounded-sm px-1.5 py-1 text-xs text-[var(--color-fg-mid)] underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]">
        联系
      </summary>
      <div className="mt-2 min-w-56 max-w-full space-y-1.5 rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] p-2 text-xs text-[var(--color-fg-mid)]">
        {!hasContact ? (
          <p>暂无可用联系方式</p>
        ) : (
          <>
            {contacts.map(({ label, value }) => (
              <div key={label} className="flex min-w-0 items-center gap-2">
                <span className="w-14 shrink-0 text-[var(--color-fg-dim)]">{label}</span>
                <span className="min-w-0 flex-1 truncate font-mono">{value}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="shrink-0 px-1.5"
                  aria-label={`复制${label}`}
                  onClick={() => void copyValue(label, value)}
                >
                  复制
                </Button>
              </div>
            ))}
            {steamProfileUrl && (
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-[var(--color-fg-dim)]">Steam</span>
                <a
                  href={steamProfileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate underline underline-offset-2 hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
                >
                  打开主页 ↗
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}
