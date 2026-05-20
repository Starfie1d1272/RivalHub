import React, { type ReactNode } from "react";
import type { UseFormRegister } from "react-hook-form";
import type { RegistrationInput } from "@/lib/validators/registration";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RegistrationSectionTitle } from "./RegistrationSectionTitle";

interface ScreenshotLinksSectionProps {
  screenshotCount: number;
  inputClassName: string;
  register: UseFormRegister<RegistrationInput>;
  renderError: (name: string) => ReactNode;
}

export function ScreenshotLinksSection({
  screenshotCount,
  inputClassName,
  register,
  renderError,
}: ScreenshotLinksSectionProps) {
  return (
    <section>
      <RegistrationSectionTitle>近两周天梯截图</RegistrationSectionTitle>
      <p className="text-sm text-[var(--color-fg-mid)] mb-4">
        可将近两周天梯对局截图上传至
        <a
          href="https://box.nju.edu.cn"
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-accent)] hover:underline mx-1"
        >
          NJUBox
        </a>
        并获取分享链接，粘贴到下方。未准备好也可以先留空。
      </p>
      <div className="space-y-3">
        {Array.from({ length: screenshotCount }, (_, index) => (
          <div key={index}>
            <Label htmlFor={`screenshotUrls.${index}`} className="text-[var(--color-fg-mid)] mb-1.5 block">
              NJUBox 分享链接 {screenshotCount > 1 ? index + 1 : ""}（选填）
            </Label>
            <Input
              id={`screenshotUrls.${index}`}
              type="url"
              placeholder="https://box.nju.edu.cn/d/..."
              className={inputClassName}
              {...register(`screenshotUrls.${index}`)}
            />
            {renderError(`screenshotUrls.${index}`)}
          </div>
        ))}
        {renderError("screenshotUrls")}
      </div>
    </section>
  );
}
