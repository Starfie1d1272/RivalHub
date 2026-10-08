/** @vitest-environment node */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PageHeader,
  PageLayout,
  Section,
} from "@/components/rivalhub";

describe("RivalHub UI foundation", () => {
  it("renders semantic page and section headings", () => {
    const html = renderToStaticMarkup(
      <PageLayout variant="workbench">
        <PageHeader title="比赛总览" eyebrow="Major" description="查看赛程" />
        <Section aria-label="赛程区块">内容</Section>
      </PageLayout>,
    );

    expect(html).toContain("比赛总览");
    expect(html).toContain('aria-label="赛程区块"');
    expect(html).not.toContain("<main");
  });

  it("uses main only when explicitly chosen by the page owner", () => {
    expect(renderToStaticMarkup(<PageLayout as="main">主内容</PageLayout>)).toContain("<main");
  });
});
