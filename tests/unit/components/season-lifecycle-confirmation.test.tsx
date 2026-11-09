import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { expect, it, vi } from "vitest";
import { SeasonForm } from "@/components/admin/SeasonForm";
import { createCompetitionTemplate } from "@/lib/competition/templates";

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  open: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/components/admin/SeasonLogoEditor", () => ({ SeasonLogoEditor: () => null }));
vi.mock("@/actions/seasons", () => ({
  publishSeason: mocks.publish,
  openSeasonRegistration: mocks.open,
  createSeason: vi.fn(),
  deleteSeason: vi.fn(),
  updateSeason: vi.fn(),
  revertSeasonToDraft: vi.fn(),
  revertSeasonToRegistration: vi.fn(),
  forceFinishSeason: vi.fn(),
  archiveSeason: vi.fn(),
}));
vi.mock("@/lib/telemetry/client", () => ({ observeAction: (_name: string, action: unknown) => action }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const initial: NonNullable<ComponentProps<typeof SeasonForm>["initial"]> = {
  ...createCompetitionTemplate("rivals"),
  id: "season",
  name: "已保存赛事",
  slug: "fixture-season",
  kind: "Rivals",
  template: "rivals",
  status: "draft",
  themeColor: null,
  registrationOpensAt: "2099-01-01T10:00",
  registrationClosesAt: null,
  rosterChangeClosesAt: null,
  endAt: null,
  confirmation: { version: "saved-draft", registrationOpensAt: "2099-01-01T02:00:00.000Z" },
};

it("uses the saved name, schedule and version even when the visible form contains edits", async () => {
  mocks.publish.mockResolvedValue({
    success: false,
    error: { code: "SEASON_CONFIGURATION_CHANGED", message: "已保存的赛事配置已变化" },
  });
  mocks.open.mockResolvedValue({ success: true, data: { slug: initial.slug } });
  const user = userEvent.setup();
  const { rerender } = render(<SeasonForm mode="edit" initial={initial} competitivePlatforms={[]} />);
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "未保存名称" } });
  fireEvent.change(screen.getByLabelText("报名开放时间"), { target: { value: "2001-01-01T10:00" } });
  const publish = screen.getByRole("button", { name: "发布赛季" });
  await user.click(publish);
  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent("已保存赛事");
  expect(dialog).toHaveTextContent("2099");
  expect(dialog).not.toHaveTextContent("未保存名称");
  expect(dialog).not.toHaveTextContent("2001");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(publish).toHaveFocus());
  expect(mocks.publish).not.toHaveBeenCalled();

  await user.click(publish);
  await user.click(screen.getByRole("button", { name: "确认发布" }));
  expect(mocks.publish).toHaveBeenCalledExactlyOnceWith({ seasonId: "season", expectedVersion: "saved-draft" });
  expect(await screen.findByRole("alert")).toHaveTextContent("已保存的赛事配置已变化");
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1);

  rerender(<SeasonForm
    mode="edit"
    initial={{ ...initial, status: "registration", confirmation: { ...initial.confirmation!, version: "published" } }}
    competitivePlatforms={[]}
  />);
  expect(screen.getByLabelText("报名开放时间")).toHaveValue("2001-01-01T10:00");
  await user.click(screen.getByRole("button", { name: /^开放报名$/ }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("提前开放报名");
  await user.click(screen.getByRole("button", { name: "确认提前开放" }));
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith({
    seasonId: "season", expectedVersion: "published", mode: "early_force",
  });
});
