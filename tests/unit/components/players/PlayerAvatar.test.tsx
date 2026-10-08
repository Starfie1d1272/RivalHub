import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";

describe("PlayerAvatar", () => {
  it("uses accessible initials when the persisted URL is missing", () => {
    render(<PlayerAvatar name="Player One" avatarUrl={null} />);
    expect(screen.getByRole("img", { name: "Player One" })).toHaveTextContent("P");
  });

  it("delivers persisted Steam avatars directly without the Next image optimizer", () => {
    const avatarUrl = "https://avatars.steamstatic.com/direct.jpg";
    render(<PlayerAvatar name="Player" avatarUrl={avatarUrl} />);
    expect(screen.getByRole("img", { name: "Player" })).toHaveAttribute("src", avatarUrl);
  });

  it("falls back after failure and allows a changed URL", () => {
    const { rerender } = render(<PlayerAvatar name="Player" avatarUrl="https://avatars.steamstatic.com/old.jpg" />);
    fireEvent.error(screen.getByRole("img", { name: "Player" }));
    expect(screen.getByRole("img", { name: "Player" })).toHaveTextContent("P");
    rerender(<PlayerAvatar name="Player" avatarUrl="https://avatars.steamstatic.com/new.jpg" />);
    expect(screen.getByRole("img", { name: "Player" })).toHaveAttribute("src", "https://avatars.steamstatic.com/new.jpg");
  });
});
