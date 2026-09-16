/** @vitest-environment jsdom */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeamLogo } from "@/components/teams/TeamLogo";

vi.mock("next/image", () => ({
  default: ({ alt, fill, unoptimized, ...props }: { alt?: string; fill?: boolean; unoptimized?: boolean; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} alt={alt ?? ""} data-fill={String(Boolean(fill))} data-unoptimized={String(Boolean(unoptimized))} />
  ),
}));

describe("TeamLogo", () => {
  it("bypasses the optimizer for a normal public team logo", () => {
    render(<TeamLogo logoUrl="https://storage.test/team.png" teamName="Rival Team" />);

    expect(screen.getByRole("img", { name: "队伍图标：Rival Team" })).toHaveAttribute("src", "https://storage.test/team.png");
    expect(screen.getByRole("img", { name: "队伍图标：Rival Team" })).toHaveAttribute("data-unoptimized", "true");
  });

  it("uses a stable initial fallback when the logo is missing", () => {
    const { container } = render(<TeamLogo logoUrl={null} teamName="Rival Team" />);

    expect(screen.getByRole("img", { name: "队伍图标：Rival Team" })).toHaveTextContent("R");
    expect(container.querySelector("img")).toBeNull();
  });

  it("replaces a failed remote image with the same stable fallback", () => {
    const { container } = render(<TeamLogo logoUrl="https://storage.test/team.png" teamName="Rival Team" />);
    fireEvent.error(screen.getByRole("img", { name: "队伍图标：Rival Team" }));

    expect(screen.getByRole("img", { name: "队伍图标：Rival Team" })).toHaveTextContent("R");
    expect(container.querySelector("img")).toBeNull();
  });
});
