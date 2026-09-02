import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RulesPage from "@/app/rules/page";
import SpringRulesArchivePage from "@/app/rules/spring/page";

function countH1(html: string) {
  return html.match(/<h1\b/g)?.length ?? 0;
}

describe("rules pages", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
  });

  it("renders the Major Markdown document with one page-level H1", async () => {
    const html = renderToStaticMarkup(await RulesPage());

    expect(countH1(html)).toBe(1);
    expect(html).toContain("NJU Major 赛事规则");
    expect(html).toContain("<h2");
    expect(html).toContain("<strong");
    expect(html).toContain("<blockquote");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).toContain('href="/rules/spring"');
    expect(html).not.toContain("## 1. 报名规则");
    expect(html).not.toContain("<pre");
  });

  it("keeps the historical Spring rules page independent", () => {
    const html = renderToStaticMarkup(React.createElement(SpringRulesArchivePage));

    expect(html).toContain("NJU RIVALS 规则书");
    expect(countH1(html)).toBe(1);
  });
});
