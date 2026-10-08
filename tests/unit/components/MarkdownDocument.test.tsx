/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownDocument } from "@/components/content/MarkdownDocument";

const markdown = `# 文档标题

## 赛事规则

[规则链接](https://example.com/rules)


| 项目 | 说明 |
| --- | --- |
| A | B |

<script>alert("xss")</script>`;

describe("MarkdownDocument", () => {
  it("enables GFM tables and safe links while ignoring raw HTML", () => {
    const { container } = render(<MarkdownDocument omitLeadingH1>{markdown}</MarkdownDocument>);

    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "赛事规则" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "规则链接" })).toHaveAttribute("href", "https://example.com/rules");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "项目" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "B" })).toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("alert(\"xss\")");
  });

  it("omits only the leading document H1 and preserves later H1 structure", () => {
    render(
      <MarkdownDocument omitLeadingH1>{"# 文档标题\n\n# 附录标题"}</MarkdownDocument>,
    );

    expect(screen.queryByRole("heading", { level: 1, name: "文档标题" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "附录标题" })).toBeInTheDocument();
  });
});
