import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InformationFeedbackLauncher } from "@/components/operations/InformationFeedbackLauncher";
import type { PublicAnnouncement } from "@/lib/announcements/presentation";
import type { PublicSeasonInfo } from "@/lib/season-public-info/presentation";

const { submitFeedbackMock } = vi.hoisted(() => ({
  submitFeedbackMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/spring-2026" }));
vi.mock("@/actions/feedback", () => ({ submitFeedback: submitFeedbackMock }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const announcement: PublicAnnouncement = {
  id: "announcement-1",
  scope: "season",
  scopeLabel: "春季赛",
  season: { slug: "spring-2026", name: "春季赛" },
  type: "notice",
  typeLabel: "通知",
  title: "赛程已更新",
  body: "请查看最新赛程。",
  publishedAt: "2026-09-10T08:00:00.000Z",
  updatedAt: "2026-09-10T08:00:00.000Z",
  requiresAttention: false,
  attentionUntil: null,
};

const seasonInfo: PublicSeasonInfo = {
  rules: { label: "赛事规程", href: "/rules" },
  groups: [],
  contacts: [],
};

describe("InformationFeedbackLauncher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("marks an ordinary announcement as read when the launcher opens", async () => {
    render(
      <InformationFeedbackLauncher
        latestAnnouncement={announcement}
        attentionAnnouncement={null}
        season={{ id: "season-1", slug: "spring-2026" }}
        seasonInfo={seasonInfo}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText("有新公告")).toBeInTheDocument());
    const launcher = screen.getByRole("button", { name: "信息与反馈" });
    fireEvent.click(launcher);

    expect(window.localStorage.getItem("rivalhub:announcement-ack:announcement-1")).toBe(announcement.updatedAt);
    await waitFor(() => expect(screen.queryByLabelText("有新公告")).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "信息与反馈" })).toBeInTheDocument();
    expect(launcher).toHaveAttribute("aria-expanded", "true");
  });

  it("closes the lightweight panel with Escape and returns focus to the launcher", () => {
    render(<InformationFeedbackLauncher latestAnnouncement={null} attentionAnnouncement={null} />);
    const launcher = screen.getByRole("button", { name: "信息与反馈" });

    fireEvent.click(launcher);
    expect(screen.getByRole("dialog", { name: "信息与反馈" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "信息与反馈" })).not.toBeInTheDocument();
    expect(launcher).toHaveFocus();
  });
});
