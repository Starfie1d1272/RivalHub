import React, { type ReactNode } from "react";
import type { UseFormRegister, UseFormWatch } from "react-hook-form";
import type { RegistrationInput } from "@/lib/validators/registration";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RegistrationSectionTitle } from "./RegistrationSectionTitle";

interface RegistrationOtherSectionProps {
  inputClassName: string;
  register: UseFormRegister<RegistrationInput>;
  watch: UseFormWatch<RegistrationInput>;
  renderError: (name: string) => ReactNode;
}

export function RegistrationOtherSection({
  inputClassName,
  register,
  watch,
  renderError,
}: RegistrationOtherSectionProps) {
  return (
    <section>
      <RegistrationSectionTitle>其他</RegistrationSectionTitle>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <input
            id="willingToBeCaptain"
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
            {...register("willingToBeCaptain")}
          />
          <div>
            <Label htmlFor="willingToBeCaptain" className="text-[var(--color-fg)] cursor-pointer">
              我愿意参与队长竞选
            </Label>
            <p className="text-xs text-[var(--color-fg-dim)] mt-0.5">
              勾选后将出现在队长投票候选人列表中
            </p>
          </div>
        </div>

        <div>
          <Label htmlFor="notes" className="text-[var(--color-fg-mid)] mb-1.5 block">
            备注（选填）
          </Label>
          <Textarea
            id="notes"
            rows={3}
            placeholder="时间冲突、特殊情况等可在此说明…"
            className={`${inputClassName} resize-none`}
            {...register("notes")}
          />
          <div className="flex justify-between mt-1">
            {renderError("notes")}
            <span className="text-xs text-[var(--color-fg-dim)] ml-auto">
              {watch("notes")?.length ?? 0}/500
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
