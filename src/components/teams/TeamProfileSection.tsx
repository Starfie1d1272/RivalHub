"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Panel } from "@/components/rivalhub";
import { TeamLogoUpload } from "@/components/teams/TeamLogoUpload";

export function TeamProfileSection({
  team,
  isCaptain,
  pending,
  name,
  description,
  recruiting,
  onNameChange,
  onDescriptionChange,
  onRecruitingChange,
  onSave,
  onLeave,
}: {
  team: { id: string; name: string; logoUrl: string | null };
  isCaptain: boolean;
  pending: boolean;
  name: string;
  description: string;
  recruiting: boolean;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onRecruitingChange: (value: boolean) => void;
  onSave: () => void;
  onLeave: () => void;
}) {
  return <Panel label="队伍资料" pad={20}><div className="flex flex-col gap-4 sm:flex-row sm:items-start">
    <TeamLogoUpload teamId={team.id} currentLogoUrl={team.logoUrl} teamName={team.name} canEdit={isCaptain} />
    <div className="min-w-0 flex-1 space-y-4">
      <div className="space-y-1.5"><Label htmlFor={`team-name-${team.id}`}>队伍名称</Label><Input id={`team-name-${team.id}`} value={name} disabled={!isCaptain} onChange={(event) => onNameChange(event.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor={`team-description-${team.id}`}>简介</Label><Input id={`team-description-${team.id}`} value={description} disabled={!isCaptain} onChange={(event) => onDescriptionChange(event.target.value)} /></div>
      {isCaptain ? <Button type="button" disabled={pending} onClick={onSave}>保存资料</Button> : <Button type="button" variant="outline" disabled={pending} onClick={onLeave}>退出队伍</Button>}
      {isCaptain && <div className="flex items-center gap-3 border-t border-[var(--color-border)] pt-3"><Switch id={`team-recruiting-${team.id}`} checked={recruiting} onCheckedChange={onRecruitingChange} disabled={pending} /><Label htmlFor={`team-recruiting-${team.id}`}>公开招募中</Label></div>}
    </div>
  </div></Panel>;
}
