"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateProfile, type ProfileInput } from "@/actions/account";
import { Field } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";

interface ProfileFormProps {
  current: {
    displayName: string | null;
    steamName: string | null;
    perfectName: string | null;
    steam64: string | null;
    steamProfileUrl: string | null;
    qq: string | null;
  };
}

export function ProfileForm({ current }: ProfileFormProps) {
  const [form, setForm] = useState<ProfileInput>({
    displayName: current.displayName ?? "",
    steamName: current.steamName ?? "",
    perfectName: current.perfectName ?? "",
    steam64: current.steam64 ?? "",
    steamProfileUrl: current.steamProfileUrl ?? "",
    qq: current.qq ?? "",
  });
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateProfile(form);
      if (result.success) {
        toast.success("个人信息已更新");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function set(key: keyof ProfileInput) {
    return (value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field
        id="display-name"
        label="自定义昵称"
        type="text"
        placeholder="展示优先级最高的昵称"
        value={form.displayName}
        onChange={set("displayName")}
        required
        minLength={2}
        maxLength={20}
      />
      <Field
        id="perfect-name"
        label="完美平台昵称"
        type="text"
        placeholder="完美世界竞技平台昵称"
        value={form.perfectName}
        onChange={set("perfectName")}
        maxLength={40}
      />
      <Field
        id="steam-name"
        label="Steam 昵称"
        type="text"
        placeholder="Steam 显示名称"
        value={form.steamName}
        onChange={set("steamName")}
        maxLength={40}
      />
      <Field
        id="steam64"
        label="Steam64 ID"
        type="text"
        placeholder="17 位数字 ID"
        value={form.steam64}
        onChange={set("steam64")}
        maxLength={17}
      />
      <Field
        id="steam-profile-url"
        label="Steam 个人资料链接"
        type="url"
        placeholder="https://steamcommunity.com/..."
        value={form.steamProfileUrl}
        onChange={set("steamProfileUrl")}
      />
      <Field
        id="qq"
        label="QQ 号"
        type="text"
        placeholder="用于赛事沟通"
        value={form.qq}
        onChange={set("qq")}
        maxLength={12}
      />
      <Button type="submit" variant="outline" className="w-full" disabled={isPending}>
        {isPending ? "保存中…" : "保存信息"}
      </Button>
    </form>
  );
}
