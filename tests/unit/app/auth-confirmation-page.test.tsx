import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const emailConfirmationFormMock = vi.hoisted(() => vi.fn(() => null));
const secondaryIdentityConfirmationFormMock = vi.hoisted(() => vi.fn(() => null));

vi.mock("@/components/auth/EmailConfirmationForm", () => ({
  EmailConfirmationForm: emailConfirmationFormMock,
}));
vi.mock("@/components/auth/SecondaryIdentityConfirmationForm", () => ({
  SecondaryIdentityConfirmationForm: secondaryIdentityConfirmationFormMock,
}));

import ConfirmationPage from "@/app/auth/confirmation/page";

describe("email confirmation page", () => {
  it("缺失或非法参数时显示可操作失败页，而不渲染确认控件", async () => {
    vi.stubGlobal("React", React);
    const page = await ConfirmationPage({ searchParams: Promise.resolve({ flow: "unknown" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("邮箱验证未完成");
    expect(html).toContain("返回登录");
    expect(emailConfirmationFormMock).not.toHaveBeenCalled();
  });

  it("只有带有允许 flow 与 token 的 GET 才展示显式确认控件", async () => {
    vi.stubGlobal("React", React);
    const page = await ConfirmationPage({
      searchParams: Promise.resolve({ flow: "reverify", token_hash: "opaque-token", next: "/settings/education" }),
    });
    renderToStaticMarkup(page);

    expect(emailConfirmationFormMock).toHaveBeenCalledWith(
      { flow: "reverify", tokenHash: "opaque-token", next: "/settings/education" },
      undefined,
    );
  });

  it("把第二邮箱的受限 provider OTP 类型传给确认表单", async () => {
    vi.stubGlobal("React", React);
    const page = await ConfirmationPage({
      searchParams: Promise.resolve({
        flow: "link_identity",
        token_hash: "opaque-token",
        request: "11111111-1111-4111-8111-111111111111",
        state: "opaque-state-token",
        type: "email",
      }),
    });
    renderToStaticMarkup(page);

    expect(secondaryIdentityConfirmationFormMock).toHaveBeenCalledWith(
      {
        tokenHash: "opaque-token",
        requestId: "11111111-1111-4111-8111-111111111111",
        stateToken: "opaque-state-token",
        otpType: "email",
      },
      undefined,
    );
  });

  it("不为未允许的第二邮箱 OTP 类型渲染确认表单", async () => {
    vi.stubGlobal("React", React);
    const page = await ConfirmationPage({
      searchParams: Promise.resolve({
        flow: "link_identity",
        token_hash: "opaque-token",
        request: "11111111-1111-4111-8111-111111111111",
        state: "opaque-state-token",
        type: "recovery",
      }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("邮箱验证未完成");
    expect(secondaryIdentityConfirmationFormMock).not.toHaveBeenCalled();
  });
});
