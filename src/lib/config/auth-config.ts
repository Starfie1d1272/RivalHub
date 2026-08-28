export const MIN_PASSWORD_LENGTH = 6;

export const PASSWORD_POLICY_MESSAGE =
  `密码至少 ${MIN_PASSWORD_LENGTH} 位，并包含大写字母、小写字母、数字和特殊字符`;

const PASSWORD_SPECIAL_CHARACTERS = "!@#$%^&*()_+-=[]{};':\"|<>?,./`~";

export function isPasswordPolicySatisfied(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /[0-9]/.test(password)
    && [...password].some((character) => PASSWORD_SPECIAL_CHARACTERS.includes(character));
}
