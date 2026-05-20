import React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RegistrationSubmitBarProps {
  canSaveDraft: boolean;
  canSubmit: boolean;
  isSubmitting: boolean;
  savingDraft: boolean;
  submitText: string;
  onSaveDraft: () => void;
}

export function RegistrationSubmitBar({
  canSaveDraft,
  canSubmit,
  isSubmitting,
  savingDraft,
  submitText,
  onSaveDraft,
}: RegistrationSubmitBarProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={!canSaveDraft || savingDraft}
        className="h-11 text-base font-semibold"
        onClick={onSaveDraft}
      >
        {savingDraft ? (
          <>
            <Loader2 size={16} className="animate-spin mr-2" />
            保存中…
          </>
        ) : (
          "保存草稿"
        )}
      </Button>
      <Button
        type="submit"
        disabled={!canSubmit || isSubmitting}
        className="h-11 text-base font-semibold"
        style={{ backgroundColor: canSubmit ? "var(--color-accent)" : "var(--color-panel-hi)", color: "#fff" }}
      >
        {isSubmitting ? (
          <>
            <Loader2 size={16} className="animate-spin mr-2" />
            提交中…
          </>
        ) : (
          submitText
        )}
      </Button>
    </div>
  );
}
