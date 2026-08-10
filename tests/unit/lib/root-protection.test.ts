import { afterEach, describe, expect, it, vi } from "vitest";
import { isProtectedRootUsername, LEGACY_ROOT_USERNAME } from "@/lib/auth/root-protection";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isProtectedRootUsername", () => {
  it("legacy RivalHub_root → protected（即使未配置 env）", () => {
    delete process.env.RIVALHUB_ROOT_USERNAME;
    expect(isProtectedRootUsername(LEGACY_ROOT_USERNAME)).toBe(true);
    expect(isProtectedRootUsername("RivalHub_root")).toBe(true);
  });

  it("未配置 env 时普通用户名 → 不保护", () => {
    delete process.env.RIVALHUB_ROOT_USERNAME;
    expect(isProtectedRootUsername("other_admin")).toBe(false);
    expect(isProtectedRootUsername("super_admin_1")).toBe(false);
  });

  it("configured custom root → protected", () => {
    vi.stubEnv("RIVALHUB_ROOT_USERNAME", "custom_root");
    expect(isProtectedRootUsername("custom_root")).toBe(true);
  });

  it("configured custom root 存在时 legacy 仍受保护", () => {
    vi.stubEnv("RIVALHUB_ROOT_USERNAME", "custom_root");
    expect(isProtectedRootUsername("RivalHub_root")).toBe(true);
  });

  it("configured custom root 存在时其他用户名 → 不保护", () => {
    vi.stubEnv("RIVALHUB_ROOT_USERNAME", "custom_root");
    expect(isProtectedRootUsername("other_admin")).toBe(false);
  });

  it("env 为空字符串 → 视为未配置，仅 legacy 受保护", () => {
    vi.stubEnv("RIVALHUB_ROOT_USERNAME", "");
    expect(isProtectedRootUsername("RivalHub_root")).toBe(true);
    expect(isProtectedRootUsername("any_name")).toBe(false);
  });

  it("env 带首尾空格时按 trim 后的 username 匹配（与 seed 行为一致）", () => {
    vi.stubEnv("RIVALHUB_ROOT_USERNAME", "  custom_root  ");
    expect(isProtectedRootUsername("custom_root")).toBe(true);
  });

  it("null / undefined / 空串 → 不保护", () => {
    delete process.env.RIVALHUB_ROOT_USERNAME;
    expect(isProtectedRootUsername(null)).toBe(false);
    expect(isProtectedRootUsername(undefined)).toBe(false);
    expect(isProtectedRootUsername("")).toBe(false);
  });
});
