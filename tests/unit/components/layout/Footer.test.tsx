/**
 * @vitest-environment jsdom
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Footer } from "@/components/layout/Footer";

describe("Footer", () => {
  beforeEach(() => vi.stubGlobal("React", React));

  it("reserves the launcher safe area only when the footer becomes a desktop row", () => {
    const html = renderToStaticMarkup(<Footer />);

    expect(html).toContain("px-7 py-5");
    expect(html).toContain("sm:pr-20");
    expect(html).toContain("RULES");
    expect(html).toContain("PRIVACY");
  });
});
