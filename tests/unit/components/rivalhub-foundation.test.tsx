import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader, PageLayout, Section, Panel } from "@/components/rivalhub";
import { DialogBody } from "@/components/ui/dialog";

describe("RivalHub UI foundation", () => {
  it("keeps Panel outer styling separate from its content contract", () => {
    const html = renderToStaticMarkup(
      <Panel className="overflow-hidden" contentClassName="space-y-4 p-0">
        内容
      </Panel>,
    );

    expect(html).toContain("overflow-hidden");
    expect(html).toContain("space-y-4 p-0");
    expect(html).not.toContain("pad");
  });

  it("renders semantic page and section headings", () => {
    const html = renderToStaticMarkup(
      <PageLayout as="div" variant="workbench">
        <PageHeader title="比赛总览" eyebrow="Major" description="查看赛程" />
        <Section aria-label="赛程区块">内容</Section>
      </PageLayout>,
    );

    expect(html).toContain('data-layout-variant="workbench"');
    expect(html).toContain("比赛总览");
    expect(html).toContain('aria-label="赛程区块"');
  });

  it("provides a scrollable Dialog body slot", () => {
    const html = renderToStaticMarkup(<DialogBody>长内容</DialogBody>);

    expect(html).toContain("min-h-0");
    expect(html).toContain("overflow-y-auto");
  });
});
