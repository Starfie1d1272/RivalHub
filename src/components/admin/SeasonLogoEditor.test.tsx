import { cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { uploadSeasonLogo } from "@/actions/season-public-info";
import { SeasonLogoEditor } from "./SeasonLogoEditor";

const { refresh, error } = vi.hoisted(() => ({ refresh: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { error, success: vi.fn() } }));
vi.mock("@/actions/season-public-info", () => ({
  uploadSeasonLogo: vi.fn().mockResolvedValue({ success: true, data: { logoUrl: "/fixture.png" } }),
  removeSeasonLogo: vi.fn(),
}));
vi.mock("@/lib/telemetry/client", () => ({ observeAction: (_: string, action: unknown) => action }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// A visible SSR file input must not accept a selection before onChange exists.
it("disables SSR upload, then handles the first invalid and valid selections after hydration", async () => {
  const user = userEvent.setup({ applyAccept: false });
  const view = <SeasonLogoEditor seasonId="fixture" logoUrl={null} />;
  const container = document.createElement("div");
  container.innerHTML = renderToString(view);
  document.body.append(container);
  const input = within(container).getByLabelText("上传赛事 Logo");
  expect(input).toBeDisabled();
  render(view, { container, hydrate: true });
  expect(input).toBeEnabled();
  await user.upload(input, new File(["<svg/>"], "invalid.svg", { type: "image/svg+xml" }));
  expect(error).toHaveBeenCalledOnce();
  expect(uploadSeasonLogo).not.toHaveBeenCalled();
  await user.upload(input, new File(["fixture"], "valid.png", { type: "image/png" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(uploadSeasonLogo).toHaveBeenCalledOnce();
});

it("also disables an SSR removal until the click handler is attached", () => {
  const view = <SeasonLogoEditor seasonId="fixture" logoUrl="/fixture.png" />;
  const container = document.createElement("div");
  container.innerHTML = renderToString(view);
  document.body.append(container);
  const remove = within(container).getByRole("button", { name: "移除赛事 Logo" });
  expect(remove).toBeDisabled();
  render(view, { container, hydrate: true });
  expect(remove).toBeEnabled();
});
