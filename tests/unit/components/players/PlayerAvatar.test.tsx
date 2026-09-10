import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";

describe("PlayerAvatar", () => {
  it("uses accessible initials when the persisted URL is missing", () => {
    render(<PlayerAvatar name="Player One" avatarUrl={null} />);
    expect(screen.getByRole("img", { name: "Player One" })).toHaveTextContent("P");
    expect(document.querySelector("img")).toBeNull();
  });
  it("falls back after failure and allows a changed URL", () => {
    const { rerender } = render(<PlayerAvatar name="Player" avatarUrl="https://avatars.steamstatic.com/old.jpg" />);
    fireEvent.error(screen.getByRole("img", { name: "Player" }));
    expect(document.querySelector("img")).toBeNull();
    rerender(<PlayerAvatar name="Player" avatarUrl="https://avatars.steamstatic.com/new.jpg" />);
    expect(document.querySelector("img")).not.toBeNull();
  });
});
