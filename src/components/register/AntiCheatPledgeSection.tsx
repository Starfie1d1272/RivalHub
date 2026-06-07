import React, { type ReactNode } from "react";
import { Label } from "@/components/ui/label";

interface AntiCheatPledgeSectionProps {
  defaultChecked: boolean;
  error?: ReactNode;
  onCheckedChange: (checked: boolean) => void;
}

export function AntiCheatPledgeSection({
  defaultChecked,
  error,
  onCheckedChange,
}: AntiCheatPledgeSectionProps) {
  return (
    <section
      className="rounded-lg border p-4"
      style={{ borderColor: "rgba(255,196,77,0.4)", background: "rgba(255,196,77,0.05)" }}
    >
      <div className="flex items-start gap-3">
        <input
          id="antiCheatPledge"
          type="checkbox"
          defaultChecked={defaultChecked}
          className="mt-0.5 h-4 w-4 accent-amber-400"
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
        <div>
          <Label htmlFor="antiCheatPledge" className="text-[var(--color-fg)] cursor-pointer font-medium">
            反作弊承诺 <span className="text-[var(--color-danger)]">*</span>
          </Label>
          <p className="text-sm text-[var(--color-fg-mid)] mt-1">
            我承诺在参赛期间不使用任何作弊软件或外挂。一经发现，接受取消资格处理。
          </p>
        </div>
      </div>
      {error}
    </section>
  );
}
