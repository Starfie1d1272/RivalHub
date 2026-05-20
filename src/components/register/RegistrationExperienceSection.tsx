import React, { type ReactNode } from "react";
import type { UseFormRegister, UseFormWatch } from "react-hook-form";
import type { RegistrationInput } from "@/lib/validators/registration";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RegistrationSectionTitle } from "./RegistrationSectionTitle";

interface RegistrationExperienceSectionProps {
  inputClassName: string;
  register: UseFormRegister<RegistrationInput>;
  watch: UseFormWatch<RegistrationInput>;
  renderError: (name: string) => ReactNode;
}

export function RegistrationExperienceSection({
  inputClassName,
  register,
  watch,
  renderError,
}: RegistrationExperienceSectionProps) {
  return (
    <section>
      <RegistrationSectionTitle>风格与经历</RegistrationSectionTitle>
      <div className="space-y-4">
        <div>
          <Label htmlFor="gameplayStyle" className="text-[var(--color-fg-mid)] mb-1.5 block">
            游戏风格自述 <span className="text-[var(--color-danger)]">*</span>
          </Label>
          <Textarea
            id="gameplayStyle"
            rows={3}
            placeholder="简要描述你的游戏风格、擅长打法等（100 字以内）"
            className={`${inputClassName} resize-none`}
            {...register("gameplayStyle")}
          />
          <div className="flex justify-between mt-1">
            {renderError("gameplayStyle")}
            <span className="text-xs text-[var(--color-fg-dim)] ml-auto">
              {watch("gameplayStyle")?.length ?? 0}/100
            </span>
          </div>
        </div>

        <div>
          <Label htmlFor="competitionHistory" className="text-[var(--color-fg-mid)] mb-1.5 block">
            历史比赛经历（选填）
          </Label>
          <Textarea
            id="competitionHistory"
            rows={3}
            placeholder="参加过的比赛、成绩等…"
            className={`${inputClassName} resize-none`}
            {...register("competitionHistory")}
          />
          <div className="flex justify-between mt-1">
            {renderError("competitionHistory")}
            <span className="text-xs text-[var(--color-fg-dim)] ml-auto">
              {watch("competitionHistory")?.length ?? 0}/500
            </span>
          </div>
        </div>

        <div>
          <Label htmlFor="highlightVideoUrl" className="text-[var(--color-fg-mid)] mb-1.5 block">
            高光视频链接（选填）
          </Label>
          <Input
            id="highlightVideoUrl"
            type="url"
            placeholder="njubox 或其他链接，命名格式：完美ID_主选位置.mp4（≤3 分钟）"
            className={inputClassName}
            {...register("highlightVideoUrl")}
          />
          {renderError("highlightVideoUrl")}
        </div>
      </div>
    </section>
  );
}
