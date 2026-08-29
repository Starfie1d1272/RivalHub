import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { getUserSessionMock, redirectMock, loginFormMock } = vi.hoisted(() => ({
  getUserSessionMock: vi.fn(),
  redirectMock: vi.fn(),
  loginFormMock: vi.fn(() => null),
}));

vi.mock("@/lib/auth/session", () => ({ getUserSession: getUserSessionMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/components/auth/LoginForm", () => ({ LoginForm: loginFormMock }));

import LoginPage from "@/app/login/page";

describe("login page auth-aware redirects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    redirectMock.mockImplementation((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    });
  });

  it("redirects an authenticated user to a safe local next path", async () => {
    getUserSessionMock.mockResolvedValue({ userId: "user-1" });

    await expect(
      LoginPage({ searchParams: Promise.resolve({ next: "/settings/password" }) }),
    ).rejects.toThrow("REDIRECT:/settings/password");
    expect(redirectMock).toHaveBeenCalledWith("/settings/password");
  });

  it("uses settings when next is absent or an open redirect", async () => {
    getUserSessionMock.mockResolvedValue({ userId: "user-1" });

    await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "REDIRECT:/settings",
    );
    await expect(
      LoginPage({ searchParams: Promise.resolve({ next: "//evil.example/" }) }),
    ).rejects.toThrow("REDIRECT:/settings");
  });

  it("passes a sanitized local next path to the logged-out form", async () => {
    getUserSessionMock.mockResolvedValue(null);

    const page = await LoginPage({
      searchParams: Promise.resolve({ mode: "register", next: "/2026-nju-rivals/register" }),
    });
    renderToStaticMarkup(page);

    expect(loginFormMock).toHaveBeenCalledWith(
      { initialMode: "register", redirectTo: "/2026-nju-rivals/register" },
      undefined,
    );
  });
});
