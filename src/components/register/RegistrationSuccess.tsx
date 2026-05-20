import React from "react";
import { CheckCircle2 } from "lucide-react";

interface RegistrationSuccessProps {
  seasonName: string;
  submittedEmail: string;
}

export function RegistrationSuccess({ seasonName, submittedEmail }: RegistrationSuccessProps) {
  return (
    <div className="flex flex-col items-center text-center py-16 gap-4">
      <CheckCircle2 size={48} className="text-[var(--color-ok)]" />
      <h2 className="text-2xl font-bold text-[var(--color-fg)]">报名成功！</h2>
      <p className="text-[var(--color-fg-mid)] max-w-sm">
        已收到你的 <span className="font-medium text-[var(--color-fg)]">{seasonName}</span> 报名。
        报名邮箱：
      </p>
      <p className="font-mono text-sm px-3 py-1.5 rounded-md bg-[var(--color-panel-hi)] text-[var(--color-fg)]">
        {submittedEmail}
      </p>
      <p className="text-sm text-[var(--color-fg-dim)] max-w-xs">
        管理员审核通过后会另行通知，届时可使用邮箱和密码登录查看进度。
      </p>
    </div>
  );
}
