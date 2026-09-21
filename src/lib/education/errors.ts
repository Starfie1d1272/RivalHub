import { AppError, ErrorCode } from "@/lib/errors";

export type EducationErrorKey = "emailNotSelected" | "emailInvalid" | "emailNotSupported";

const MESSAGES = {
  emailNotSelected: "请选择属于当前账号的已验证学校邮箱。",
  emailInvalid: "所选邮箱信息不完整，无法进行学校邮箱认证。",
  emailNotSupported: "所选邮箱暂不支持自动认证，请选择其他认证方式。",
} satisfies Record<EducationErrorKey, string>;

export function educationAppError(
  code: ErrorCode,
  key: EducationErrorKey,
  params: Record<string, string | number | boolean | null> = {},
): AppError {
  return AppError.withPresentation(code, {
    owner: "education",
    key,
    params,
    message: MESSAGES[key],
  });
}
