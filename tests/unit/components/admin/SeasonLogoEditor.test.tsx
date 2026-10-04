import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SeasonLogoEditor } from "@/components/admin/SeasonLogoEditor";
import { EventLogo } from "@/components/season/EventLogo";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), refresh: vi.fn(), error: vi.fn() }));
vi.mock("@/actions/season-public-info", () => ({ uploadSeasonLogo: mocks.upload, removeSeasonLogo: mocks.remove }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mocks.error } }));
vi.mock("next/image", () => ({ default: ({ src, alt, onError }: React.ImgHTMLAttributes<HTMLImageElement>) =>
  // eslint-disable-next-line @next/next/no-img-element -- Testing the image error boundary with a DOM image.
  <img src={src} alt={alt} onError={onError} /> }));

describe("event logo editor", () => {
  beforeEach(() => vi.resetAllMocks());
  it("preserves the previous logo on failure and updates/removes only after successful writes", async () => {
    mocks.upload.mockResolvedValueOnce({ success: false, error: { message: "上传失败" } }).mockResolvedValueOnce({ success: true, data: { logoUrl: "/new.png" } });
    mocks.remove.mockResolvedValue({ success: true });
    render(<SeasonLogoEditor seasonId="season" logoUrl="/old.png" />);
    const file = new File(["png"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("更换赛事 Logo"), { target: { files: [file] } });
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("上传失败"));
    expect(screen.getByAltText("赛事 Logo")).toHaveAttribute("src", "/old.png");
    expect(mocks.refresh).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("更换赛事 Logo"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByAltText("赛事 Logo")).toHaveAttribute("src", "/new.png"));
    fireEvent.click(screen.getByRole("button", { name: "移除赛事 Logo" }));
    await waitFor(() => expect(screen.queryByAltText("赛事 Logo")).not.toBeInTheDocument());
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("上传赛事 Logo")).toHaveAttribute("type", "file");
  });
  it("leaves failed images optional and recovers when the canonical URL changes", () => {
    const view = render(<EventLogo logoUrl={null} />);
    expect(screen.queryByAltText("赛事 Logo")).not.toBeInTheDocument();
    view.rerender(<EventLogo logoUrl="/broken.png" />);
    fireEvent.error(screen.getByAltText("赛事 Logo"));
    expect(screen.queryByAltText("赛事 Logo")).not.toBeInTheDocument();
    view.rerender(<EventLogo logoUrl="/replacement.png" />);
    expect(screen.getByAltText("赛事 Logo")).toHaveAttribute("src", "/replacement.png");
  });
});
