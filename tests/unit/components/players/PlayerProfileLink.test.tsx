/** @vitest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";

describe("PlayerProfileLink", () => {
  it("navigates from a canonical user id with a visible focus affordance", () => {
    render(<PlayerProfileLink userId="player/1">选手甲</PlayerProfileLink>);

    const link = screen.getByRole("link", { name: "选手甲" });
    expect(link).toHaveAttribute("href", "/players/player%2F1");
    expect(link.className).toContain("focus-visible:ring-2");
  });
});
