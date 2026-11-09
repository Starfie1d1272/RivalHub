import React from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { Label } from "@/components/ui/label";
import type { RegistrationFieldFeedback } from "./registration-form-utils";

interface AntiCheatPledgeSectionProps extends RegistrationFieldFeedback {
  registration: UseFormRegisterReturn<"antiCheatPledge">;
}

export function AntiCheatPledgeSection({
  registration,
  renderError,
  errorAttributes,
}: AntiCheatPledgeSectionProps) {
  const error = errorAttributes("antiCheatPledge");
  return (
    <section
      className="rounded-lg border p-4"
      style={{ borderColor: "var(--color-warn-edge)", background: "var(--color-warn-soft)" }}
    >
      <div className="flex items-start gap-3">
        <input
          id="antiCheatPledge"
          type="checkbox"
          className="mt-0.5 size-4 accent-[var(--color-accent)]"
          {...registration}
          aria-required="true"
          aria-invalid={error["aria-invalid"]}
          aria-describedby={["antiCheatPledge-help", error["aria-describedby"]]
            .filter(Boolean)
            .join(" ")}
        />
        <div>
          <Label
            htmlFor="antiCheatPledge"
            className="text-[var(--color-fg)] cursor-pointer font-medium"
          >
            反作弊承诺 <span className="text-[var(--color-danger)]">*</span>
          </Label>
          <p id="antiCheatPledge-help" className="mt-1 text-sm text-[var(--color-fg-secondary)]">
            我承诺在参赛期间不使用任何作弊软件或外挂。一经发现，接受取消资格处理。
          </p>
        </div>
      </div>
      {renderError("antiCheatPledge")}
    </section>
  );
}
