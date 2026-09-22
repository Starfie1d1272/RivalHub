import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { SeasonPublicInfoView } from "@/components/season/SeasonPublicInfoView";
import type { PublicSeasonInfo } from "@/lib/season-public-info/presentation";

describe("SeasonPublicInfoView", () => {
  it("renders 5 community groups within responsive grid layout", () => {
    const info: PublicSeasonInfo = {
      rules: { label: "赛事规程", href: "/rules" },
      groups: [
        { id: "g1", label: "选手群 1", audience: "正赛队伍", status: "active", groupNumber: "111111", qrImageUrl: null, joinUrl: null, note: "进群请改备注" },
        { id: "g2", label: "选手群 2", audience: "公开赛队伍", status: "active", groupNumber: "222222", qrImageUrl: null, joinUrl: null, note: null },
        { id: "g3", label: "解说裁判群", audience: "裁判解说", status: "active", groupNumber: "333333", qrImageUrl: null, joinUrl: "https://example.com/join3", note: null },
        { id: "g4", label: "观众水友群", audience: "全体观众", status: "active", groupNumber: "444444", qrImageUrl: "https://example.com/qr4.png", joinUrl: null, note: null },
        { id: "g5", label: "高校联络群", audience: "高校代表", status: "active", groupNumber: "555555", qrImageUrl: null, joinUrl: null, note: null },
      ],
      contacts: [
        { id: "c1", label: "赛务组", publicName: "小助手", value: "ops@rivalhub.com", href: "mailto:ops@rivalhub.com", note: "工作日 9:00-18:00" },
      ],
    };

    const html = renderToStaticMarkup(<SeasonPublicInfoView info={info} />);

    // Responsive 2-column grid class on desktop / 1-column on mobile
    expect(html).toContain("grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2");

    // All 5 groups are rendered
    expect(html).toContain("选手群 1");
    expect(html).toContain("选手群 2");
    expect(html).toContain("解说裁判群");
    expect(html).toContain("观众水友群");
    expect(html).toContain("高校联络群");

    // Copy group number and action buttons
    expect(html).toContain("复制群号");
    expect(html).toContain("加入群聊");
    expect(html).toContain("查看二维码");
  });

  it("does not expose join URL, group number, or QR for closed groups", () => {
    const info: PublicSeasonInfo = {
      rules: { label: "赛事规程", href: "/rules" },
      groups: [
        { id: "g-closed", label: "历史预选群", audience: null, status: "closed", groupNumber: null, qrImageUrl: null, joinUrl: null, note: "该群已关闭" },
      ],
      contacts: [],
    };

    const html = renderToStaticMarkup(<SeasonPublicInfoView info={info} />);

    expect(html).toContain("历史预选群");
    expect(html).toContain("已关闭");
    expect(html).not.toContain("复制群号");
    expect(html).not.toContain("加入群聊");
    expect(html).not.toContain("查看二维码");
  });
});