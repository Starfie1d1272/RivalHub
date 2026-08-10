export const LEGACY_ROOT_USERNAME = "RivalHub_root";

/**
 * 判断 username 是否为受保护的 Root 管理员（不可停用）。
 *
 * - legacy 固定用户名 `RivalHub_root` 始终受保护：现有生产库可能存在该旧账户；
 * - 当前配置的 `RIVALHUB_ROOT_USERNAME`（非空）同样受保护：v1.30.2 起 Root 由
 *   环境变量显式初始化，自定义用户名必须继承同样的 emergency-account 保护。
 *
 * 不把普通 super_admin 纳入保护范围。
 */
export function isProtectedRootUsername(username: string | null | undefined): boolean {
  if (!username) return false;
  if (username === LEGACY_ROOT_USERNAME) return true;
  const configured = process.env.RIVALHUB_ROOT_USERNAME?.trim();
  return configured !== "" && username === configured;
}
