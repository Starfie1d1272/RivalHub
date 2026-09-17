/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ListSearchField } from "@/components/rivalhub";

describe("ListSearchField hydration readiness", () => {
  it("keeps the SSR input read-only until the client has mounted", () => {
    const onDebouncedChange = vi.fn();
    const markup = renderToString(
      <ListSearchField
        queryKey="q"
        label="搜索用户"
        value=""
        onDebouncedChange={onDebouncedChange}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    expect(container.querySelector("input")).toHaveAttribute("readonly");

    render(
      <ListSearchField
        queryKey="q"
        label="搜索用户"
        value=""
        onDebouncedChange={onDebouncedChange}
      />,
    );
    expect(screen.getByLabelText("搜索用户")).not.toHaveAttribute("readonly");
  });
});
