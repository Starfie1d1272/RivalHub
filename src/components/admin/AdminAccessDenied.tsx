import { ErrorState } from "@/components/rivalhub";
import { ErrorCode, ERROR_MESSAGES } from "@/lib/errors";

export function AdminAccessDenied() {
  return (
    <div role="alert" className="px-4 py-16">
      <ErrorState
        code={ErrorCode.FORBIDDEN}
        title={ERROR_MESSAGES[ErrorCode.FORBIDDEN]}
        sub="当前账号已登录，但没有访问此管理页面所需的权限。"
      />
    </div>
  );
}
