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

    expect(html).toContain('data-layout-variant="workbench"');
    expect(html).toContain("比赛总览");
    expect(html).toContain('aria-label="赛程区块"');
    expect(html).not.toContain("<main");
  });

  it("keeps all page width variants and supports a semantic main owner", () => {
    const html = renderToStaticMarkup(
      <>
        <PageLayout variant="narrow">窄页</PageLayout>
        <PageLayout variant="standard">标准页</PageLayout>
        <PageLayout variant="wide">宽页</PageLayout>
        <PageLayout variant="workbench">工作台</PageLayout>
        <PageLayout as="main">主内容</PageLayout>
      </>,
    );

    for (const variant of ["narrow", "standard", "wide", "workbench"]) {
      expect(html).toContain(`data-layout-variant="${variant}"`);
    }
    expect(html).toContain("<main");
    expect(html).toContain("主内容");
  });

});
