import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TeamLogoImage } from "@/components/teams/TeamLogoImage";

vi.mock("next/image", async () => {
  const { forwardRef } = await import("react");
  return { default: forwardRef<HTMLImageElement, { src: string; alt: string; onError: () => void }>(function MockImage({ src, alt, onError }, ref) {
    return <img ref={ref} src={src} alt={alt} onError={onError} />;
  }) };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("recovers a failed image whose error happened before hydration", () => {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  render(<TeamLogoImage logoUrl="https://example.invalid/logo.png" teamName="Qualification Entry" />);
  expect(screen.getByRole("img", { name: "队伍图标：Qualification Entry" })).toHaveTextContent("Q");
});

it("keeps a loading image and falls back when its request fails", () => {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);
  render(<TeamLogoImage logoUrl="https://example.invalid/logo.png" teamName="Qualification Entry" />);
  const image = screen.getByRole("img");
  expect(image.tagName).toBe("IMG");
  fireEvent.error(image);
  expect(screen.getByRole("img")).toHaveTextContent("Q");
});
