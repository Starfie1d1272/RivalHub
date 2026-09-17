"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { lookupSteamProfile, updateProfile, type ProfileInput } from "@/actions/account";
import { Field } from "@/components/rivalhub";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { COMPETITION_HISTORY_MAX_LENGTH, GAMEPLAY_STYLE_MAX_LENGTH } from "@/lib/player-declared-profile";

interface ProfileFormProps {
  current: {
    displayName: string | null;
    perfectName: string | null;
    steam64: string | null;
    steamProfile: SteamProfileCard | null;
    qq: string | null;
    liveStreamUrl: string | null;
    gameplayStyle: string | null;
    competitionHistory: string | null;
  };
}

interface SteamProfileCard {
  personaName: string;
  profileUrl: string;
  avatarUrl: string | null;
}

type SteamLookupState =
  | { status: "ok"; profile: SteamProfileCard & { steam64: string } }
  | { status: "not_found"; diagnosticUrl: string }
  | { status: "unavailable" }
  | { status: "conflict" };

export function ProfileForm({ current }: ProfileFormProps) {
  const [form, setForm] = useState<ProfileInput>({
    displayName: current.displayName ?? "",
    perfectName: current.perfectName ?? "",
    steam64: current.steam64 ?? "",
    qq: current.qq ?? "",
    liveStreamUrl: current.liveStreamUrl ?? "",
    gameplayStyle: current.gameplayStyle ?? "",
    competitionHistory: current.competitionHistory ?? "",
  });
  const [isPending, startTransition] = useTransition();
  const [isLookupPending, startLookupTransition] = useTransition();
  const [steamLookup, setSteamLookup] = useState<SteamLookupState | null>(
    current.steamProfile && current.steam64
      ? { status: "ok", profile: { ...current.steamProfile, steam64: current.steam64 } }
      : null,
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const steam64 = form.steam64.trim();
    if (steam64 && (steamLookup?.status !== "ok" || steamLookup.profile.steam64 !== steam64)) {
      toast.error("请先查询并确认 Steam 官方资料");
      return;
    }
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
    return (value: string) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      if (key === "steam64") setSteamLookup(null);
    };
  }

  function handleSteamLookup() {
    const steam64 = form.steam64.trim();
    if (!/^\d{17}$/.test(steam64)) {
      toast.error("Steam64 ID 格式不正确（应为 17 位数字）");
      return;
    }
    startLookupTransition(async () => {
      const result = await lookupSteamProfile(steam64);
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setSteamLookup(result.data);
      if (result.data.status === "ok") toast.success("已取得 Steam 官方资料");
    });
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
      <div className="space-y-4 border-t border-[var(--color-border)] pt-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">选手自述</p>
          <p className="text-xs text-[var(--color-fg-mid)]">这是长期公开资料，不属于某一届赛事报名；你可以随时更新，历史报名快照不会被改写。</p>
        </div>
        <div>
          <Label htmlFor="gameplay-style" className="mb-1.5 block font-bold uppercase" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-fg-mid)", letterSpacing: "var(--tracking-label)" }}>
            当前打法 / 风格
          </Label>
          <Textarea
            id="gameplay-style"
            rows={3}
            maxLength={GAMEPLAY_STYLE_MAX_LENGTH}
            value={form.gameplayStyle ?? ""}
            onChange={(event) => set("gameplayStyle")(event.target.value)}
            placeholder={`简要描述当前打法、擅长位置或配合方式（${GAMEPLAY_STYLE_MAX_LENGTH} 字以内）`}
          />
          <p className="mt-1 text-right text-xs text-[var(--color-fg-dim)]">{form.gameplayStyle?.length ?? 0}/{GAMEPLAY_STYLE_MAX_LENGTH}</p>
        </div>
        <div>
          <Label htmlFor="competition-history" className="mb-1.5 block font-bold uppercase" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-fg-mid)", letterSpacing: "var(--tracking-label)" }}>
            比赛经历（选填）
          </Label>
          <Textarea
            id="competition-history"
            rows={3}
            maxLength={COMPETITION_HISTORY_MAX_LENGTH}
            value={form.competitionHistory ?? ""}
            onChange={(event) => set("competitionHistory")(event.target.value)}
            placeholder={`参加过的比赛、成绩等（${COMPETITION_HISTORY_MAX_LENGTH} 字以内）`}
          />
          <p className="mt-1 text-right text-xs text-[var(--color-fg-dim)]">{form.competitionHistory?.length ?? 0}/{COMPETITION_HISTORY_MAX_LENGTH}</p>
        </div>
      </div>
      <div className="space-y-1 border-t border-[var(--color-border)] pt-4">
        <p className="text-sm font-medium">解说资料</p>
        <p className="text-xs text-[var(--color-fg-mid)]">用于你作为赛事解说时，在比赛页面向观众展示直播入口。不填写不会影响普通参赛资料。</p>
      </div>
      <Field id="live-stream-url" label="直播间链接" type="url" placeholder="https://..." value={form.liveStreamUrl ?? ""} onChange={set("liveStreamUrl")} />
      <Field
        id="perfect-name"
        label="完美平台昵称"
        type="text"
        placeholder="完美世界竞技平台昵称"
        value={form.perfectName}
        onChange={set("perfectName")}
        maxLength={40}
      />
      <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">Steam 官方资料</p>
          <p className="text-xs text-[var(--color-fg-mid)]">只填写 Steam64 ID。昵称、头像和个人资料链接由 Steam 官方数据提供，不能手动编辑。</p>
        </div>
        <Field
          id="steam64"
          label="Steam64 ID"
          type="text"
          placeholder="17 位数字 ID"
          value={form.steam64}
          onChange={set("steam64")}
          maxLength={17}
        />
        <Button type="button" variant="outline" onClick={handleSteamLookup} disabled={isPending || isLookupPending}>
          {isLookupPending ? "查询中…" : "查询 Steam 官方资料"}
        </Button>
        {steamLookup?.status === "ok" && (
          <div className="flex items-center gap-3 rounded-md border border-[var(--color-border)] p-3">
            <PlayerAvatar name={steamLookup.profile.personaName} avatarUrl={steamLookup.profile.avatarUrl} size="md" />
            <div className="min-w-0 space-y-1">
              <p className="font-medium text-[var(--color-fg)]">{steamLookup.profile.personaName}</p>
              <p className="font-mono text-xs text-[var(--color-fg-mid)]">Steam64 · {steamLookup.profile.steam64}</p>
              <a href={steamLookup.profile.profileUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline hover:text-[var(--color-accent)]">打开 Steam 个人资料</a>
            </div>
          </div>
        )}
        {steamLookup?.status === "not_found" && (
          <p className="text-sm text-[var(--color-danger)]">未找到该 Steam 账号，请检查 Steam64 ID 是否填写正确。 <a href={steamLookup.diagnosticUrl} target="_blank" rel="noopener noreferrer" className="underline">查看诊断链接</a></p>
        )}
        {steamLookup?.status === "unavailable" && <p className="text-sm text-[var(--color-danger)]">暂时无法连接 Steam，请稍后重试。</p>}
        {steamLookup?.status === "conflict" && <p className="text-sm text-[var(--color-danger)]">该 Steam64 ID 已关联其他账户，请联系管理员处理。</p>}
      </div>
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
