"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Spinner } from "@/components/rivalhub";
import { uploadTeamLogo } from "@/actions/teams";
import { uploadTeamApplicationLogo } from "@/actions/team-applications";
import { LOGO_MAX_BYTES, LOGO_ALLOWED_TYPES } from "@/lib/config/upload-limits";

interface TeamLogoUploadProps {
  teamId?: string;
  applicationId?: string;
  currentLogoUrl: string | null;
  teamName: string;
  /** 仅队长可编辑 */
  canEdit: boolean;
}

export function TeamLogoUpload({
  teamId,
  applicationId,
  currentLogoUrl,
  teamName,
  canEdit,
}: TeamLogoUploadProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentLogoUrl);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastConfirmedUrlRef = useRef<string | null>(currentLogoUrl);

  const initial = teamName.trim()[0]?.toUpperCase() ?? "?";

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // 前端预校验，后端会二次验证
    if (file.size > LOGO_MAX_BYTES) {
      toast.error("文件大小不能超过 1 MB");
      return;
    }
    if (!(LOGO_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
      toast.error("请上传 JPG、PNG 或 WebP 格式图片");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    const formData = new FormData();
    formData.append("file", file);

    startTransition(async () => {
      const result = applicationId
        ? await uploadTeamApplicationLogo(applicationId, formData)
        : teamId
          ? await uploadTeamLogo(teamId, formData)
          : { success: false as const, error: { message: "缺少队伍标识" } };
      URL.revokeObjectURL(objectUrl);
      if (result.success) {
        lastConfirmedUrlRef.current = result.data.logoUrl;
        setPreviewUrl(result.data.logoUrl);
        toast.success("队伍图标已更新");
      } else {
        setPreviewUrl(lastConfirmedUrlRef.current);
        toast.error(result.error.message);
      }
    });

    e.target.value = "";
  }

  return (
    <div className="relative inline-block">
      {/* 头像主体：80×80 圆形 */}
      <div
        className={[
          "relative h-20 w-20 overflow-hidden",
          "border-2 border-[var(--color-border)] bg-[var(--color-bg-subtle)]",
          "flex items-center justify-center select-none",
          canEdit ? "cursor-pointer group" : "",
        ].join(" ")}
        onClick={() => canEdit && !isPending && inputRef.current?.click()}
        role={canEdit ? "button" : undefined}
        aria-label={canEdit ? "更换队伍图标" : undefined}
      >
        {previewUrl ? (
          <Image
            src={previewUrl}
            alt={`${teamName} logo`}
            fill
            className="object-cover"
            unoptimized={previewUrl.startsWith("blob:")}
          />
        ) : (
          <span className="text-2xl font-bold text-[var(--color-fg-dim)]">{initial}</span>
        )}

        {/* 上传中蒙层 */}
        {isPending && (
          <div className="absolute inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-bg)_78%,transparent)]">
            <Spinner />
          </div>
        )}

        {/* 悬停蒙层（仅 canEdit） */}
        {canEdit && !isPending && (
          <div className="absolute inset-0 hidden items-center justify-center bg-[color-mix(in_srgb,var(--color-panel)_74%,transparent)] group-hover:flex">
            <span className="px-1 text-center text-[10px] font-medium leading-tight text-[var(--color-fg)]">
              更换<br />图标
            </span>
          </div>
        )}
      </div>

      {/* 隐藏 file input */}
      {canEdit && (
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
          disabled={isPending}
        />
      )}
    </div>
  );
}
