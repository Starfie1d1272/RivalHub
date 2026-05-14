"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Spinner } from "@/components/rivalhub";
import { uploadTeamLogo } from "@/actions/teams";

interface TeamLogoUploadProps {
  teamId: string;
  currentLogoUrl: string | null;
  teamName: string;
  /** 仅队长可编辑 */
  canEdit: boolean;
}

export function TeamLogoUpload({
  teamId,
  currentLogoUrl,
  teamName,
  canEdit,
}: TeamLogoUploadProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentLogoUrl);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const initial = teamName.trim()[0]?.toUpperCase() ?? "?";

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // 前端预校验（后端仍会二次校验）
    if (file.size > 1_048_576) {
      toast.error("文件大小不能超过 1 MB");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("请上传 JPG、PNG 或 WebP 格式图片");
      return;
    }

    // 即时预览
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    const formData = new FormData();
    formData.append("file", file);

    startTransition(async () => {
      const result = await uploadTeamLogo(teamId, formData);
      if (result.success) {
        // 用服务端返回的永久 URL 替换 blob URL
        URL.revokeObjectURL(objectUrl);
        setPreviewUrl(result.data.logoUrl);
        toast.success("队伍图标已更新");
      } else {
        URL.revokeObjectURL(objectUrl);
        setPreviewUrl(currentLogoUrl);
        toast.error(result.error.message);
      }
    });

    // 清空 input，允许重复上传同一文件
    e.target.value = "";
  }

  return (
    <div className="relative inline-block">
      {/* 头像主体：80×80 圆形 */}
      <div
        className={[
          "relative w-20 h-20 rounded-lg overflow-hidden",
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
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg">
            <Spinner />
          </div>
        )}

        {/* 悬停蒙层（仅 canEdit） */}
        {canEdit && !isPending && (
          <div className="absolute inset-0 hidden group-hover:flex items-center justify-center bg-black/50 rounded-lg">
            <span className="text-[10px] font-medium text-white leading-tight text-center px-1">
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
