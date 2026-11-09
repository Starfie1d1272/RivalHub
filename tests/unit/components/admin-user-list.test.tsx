import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AdminUserList } from "@/components/admin/AdminUserList";

const mocks = vi.hoisted(() => ({ revoke: vi.fn() }));
vi.mock("@/actions/admin", () => ({ revokeUserAdminRole: mocks.revoke }));
vi.mock("@/lib/telemetry/client", () => ({ observeAction: (_name: string, action: unknown) => action }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const userDefaults = {
  personaName: null,
  steam64: null,
  liveStreamUrl: null,
  perfectName: null,
  createdAt: "2026-10-01T08:30:00.000Z",
};

it("shows all scopes and the exact account before revoking, with no revocation on cancel", async () => {
  mocks.revoke.mockResolvedValue({ success: true, data: undefined });
  const user = userEvent.setup();
  render(
    <AdminUserList
      currentUserId="self"
      seasonMap={{ first: "合成甲赛事", second: "合成乙赛事" }}
      users={[
        {
          ...userDefaults,
          id: "self",
          displayName: "当前管理员",
          email: "self@example.test",
          role: "super_admin",
          seasonIds: [],
        },
        {
          ...userDefaults,
          id: "scoped",
          displayName: "合成赛事管理员",
          email: "scoped@example.test",
          role: "season_admin",
          seasonIds: ["first", "second"],
        },
        {
          ...userDefaults,
          id: "global",
          displayName: "合成全局管理员",
          email: "global@example.test",
          role: "super_admin",
          seasonIds: ["second"],
        },
      ]}
    />,
  );
  const self = screen.getByRole("row", { name: /当前管理员/ });
  expect(within(self).queryByRole("button", { name: "撤销" })).toBeNull();

  const scoped = screen.getByRole("row", { name: /合成赛事管理员/ });
  const scopedTrigger = within(scoped).getByRole("button", { name: "撤销" });
  await user.click(scopedTrigger);
  let dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent("合成赛事管理员");
  expect(dialog).toHaveTextContent("scoped@example.test");
  expect(dialog).toHaveTextContent("普通用户");
  expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
  expect(dialog).toHaveTextContent("合成甲赛事");
  expect(dialog).toHaveTextContent("合成乙赛事");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(scopedTrigger).toHaveFocus());
  expect(mocks.revoke).not.toHaveBeenCalled();

  const global = screen.getByRole("row", { name: /合成全局管理员/ });
  await user.click(within(global).getByRole("button", { name: "撤销" }));
  dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent("全局超级管理员权限");
  expect(dialog).toHaveTextContent("合成乙赛事");
  await user.click(within(dialog).getByRole("button", { name: "确认撤销全部权限" }));
  expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith("global");
});
