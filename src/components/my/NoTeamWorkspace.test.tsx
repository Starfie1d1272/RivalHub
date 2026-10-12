import { render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createTeam } from "@/actions/teams";
import { NoTeamWorkspace } from "./NoTeamWorkspace";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/actions/teams", () => ({
  createTeam: vi.fn().mockResolvedValue({ success: true }),
  acceptTeamInvitation: vi.fn(),
  declineTeamInvitation: vi.fn(),
}));

// Real DB tests begin with a submitted name. Protect the earlier input boundary:
// server HTML must not accept typing before controlled onChange is attached.
it("disables the server form and submits the first hydrated input without losing its name", async () => {
  const user = userEvent.setup();
  const board = <NoTeamWorkspace pendingInvitations={[]} />;
  const container = document.createElement("div");
  container.innerHTML = renderToString(board);
  document.body.appendChild(container);
  const form = within(container);
  const name = form.getByLabelText("队伍名称");
  const description = form.getByLabelText("简介");
  const create = form.getByRole("button", { name: "创建队伍", exact: true });
  expect(name).toBeDisabled();
  expect(description).toBeDisabled();
  expect(create).toBeDisabled();
  create.click();
  expect(createTeam).not.toHaveBeenCalled();

  render(board, { container, hydrate: true });
  expect(name).toBeEnabled();
  expect(description).toBeEnabled();
  await user.type(name, "首击队伍");
  await user.type(description, "队伍简介");
  await user.click(create);
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(createTeam).toHaveBeenCalledExactlyOnceWith({ name: "首击队伍", description: "队伍简介" });
});
