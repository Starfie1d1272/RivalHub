"use client";

import React, { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { uploadSeasonLogo, removeSeasonLogo } from "@/actions/season-public-info";
import { EventLogo } from "@/components/season/EventLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LOGO_ALLOWED_TYPES, LOGO_MAX_BYTES } from "@/lib/config/upload-limits";

export function SeasonLogoEditor({ seasonId, logoUrl }: { seasonId: string; logoUrl: string | null }) {
  const inputId = useId();
  const router = useRouter();
  const [currentUrl, setCurrentUrl] = useState(logoUrl);
  const [pending, startTransition] = useTransition();
  return <div className="space-y-3">
    <p className="text-sm text-[var(--color-fg-mid)]">用于公开赛事展示与 Mizar。上传 JPG、PNG 或 WebP 图片，最大 1 MB。</p>
    <EventLogo logoUrl={currentUrl} />
    {!currentUrl && <p className="text-sm text-[var(--color-fg-dim)]">尚未上传赛事 Logo</p>}
    <Label htmlFor={inputId}>{currentUrl ? "更换赛事 Logo" : "上传赛事 Logo"}</Label>
    <Input id={inputId} type="file" accept={LOGO_ALLOWED_TYPES.join(",")} disabled={pending} onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (!file.size || file.size > LOGO_MAX_BYTES || !(LOGO_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
        toast.error("请选择非空的 JPG、PNG 或 WebP 图片，最大 1 MB。");
        return;
      }
      const form = new FormData();
      form.set("file", file);
      startTransition(async () => {
        const result = await uploadSeasonLogo(seasonId, form);
        if (!result.success) { toast.error(result.error.message); return; }
        setCurrentUrl(result.data.logoUrl);
        toast.success("赛事 Logo 已更新");
        router.refresh();
      });
    }} />
    {pending && <p role="status" className="text-sm">正在更新赛事 Logo…</p>}
    {currentUrl && <Button type="button" variant="outline" disabled={pending} onClick={() => startTransition(async () => {
      const result = await removeSeasonLogo(seasonId);
      if (!result.success) { toast.error(result.error.message); return; }
      setCurrentUrl(null);
      toast.success("赛事 Logo 已移除");
      router.refresh();
    })}>移除赛事 Logo</Button>}
  </div>;
}
