/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrivacyContent } from "@/components/settings/PrivacyContent";

describe("PrivacyContent", () => {
  it("keeps the shared three-part privacy explanation without the display-name typo", () => {
    render(<PrivacyContent />);

    expect(screen.getByText("公开赛事资料")).toBeInTheDocument();
    expect(screen.getByText("默认仅赛事管理可见")).toBeInTheDocument();
    expect(screen.getByText("参赛确认")).toBeInTheDocument();
    expect(screen.getByText(/RivalHub 可以展示昵称/)).toBeInTheDocument();
    expect(screen.queryByText(/可以展示展示昵称/)).not.toBeInTheDocument();
  });
});
