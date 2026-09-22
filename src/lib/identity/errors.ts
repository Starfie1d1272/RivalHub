import { AppError, type ErrorCode } from "@/lib/errors";

export type IdentityErrorKey =
  | "accountMustBeActive"
  | "loginMethodNotBound"
  | "loginMethodAlreadyBound"
  | "secondaryEmailNotFound"
  | "primaryEmailCannotBeRevoked"
  | "emailStillPrimary"
  | "draftReferenceConflict"
  | "draftFactConflict"
  | "captainVoteReferenceConflict"
  | "selfVoteConflict";

const MESSAGES = {
  accountMustBeActive: "归并双方都必须是可用账号。",
  loginMethodNotBound: "该登录方式尚未绑定 RivalHub 账号，请先完成账号注册。",
  loginMethodAlreadyBound: "该登录方式已绑定另一个 RivalHub 账号，请先完成重复账号归并。",
  secondaryEmailNotFound: "该邮箱未绑定到当前账号，无法撤销。",
  primaryEmailCannotBeRevoked: "主登录邮箱不能在这里撤销。",
  emailStillPrimary: "该邮箱仍用于主登录，不能撤销。",
  draftReferenceConflict: "待删除报名仍被选秀记录引用，归并已拒绝。",
  draftFactConflict: "同一赛事的选秀记录存在冲突，归并已拒绝。",
  captainVoteReferenceConflict: "待删除报名仍被队长投票引用，归并已拒绝。",
  selfVoteConflict: "归并后会产生给自己投票的情况，归并已拒绝。",
} satisfies Record<IdentityErrorKey, string>;

export function identityAppError(
  code: ErrorCode,
  key: IdentityErrorKey,
  params: Record<string, string | number | boolean | null> = {},
): AppError {
  return AppError.withPresentation(code, {
    owner: "identity",
    key,
    params,
    message: MESSAGES[key],
  });
}
