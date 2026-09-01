import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const emailConfirmationFormMock = vi.hoisted(() => vi.fn(() => null));

vi.mock("@/components/auth/EmailConfirmationForm", () => ({
  EmailConfirmationForm: emailConfirmationFormMock,
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
});
