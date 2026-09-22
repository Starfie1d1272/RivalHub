import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Checklist,
  EmptyState,
  ErrorState,
  InlineConfirm,
  PageHeader,
  PageLayout,
  Panel,
  Section,
  Spinner,
  StatusBanner,
} from "@/components/rivalhub";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

  it("provides a scrollable Dialog body slot", () => {
    const html = renderToStaticMarkup(<DialogBody>长内容</DialogBody>);

    expect(html).toContain("min-h-0");
    expect(html).toContain("overflow-y-auto");
  });

  it("uses an explicit Dialog size contract without responsive max-width conflicts", () => {
    render(
      <Dialog open>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>名单管理</DialogTitle>
          </DialogHeader>
          <DialogBody>长内容</DialogBody>
        </DialogContent>
      </Dialog>,
    );
    const html = document.body.innerHTML;

    expect(html).toContain("bg-[var(--color-scrim)]");
    expect(html).toContain("bg-[var(--color-surface-floating)]");
    expect(html).toContain("max-w-2xl");
    expect(html).not.toContain("sm:max-w-lg");
  });

  it("keeps shared explanatory feedback readable while preserving compact markers", () => {
    const html = renderToStaticMarkup(
      <>
        <EmptyState title="暂无内容" sub="这里会说明当前为什么为空。" />
        <ErrorState title="加载失败" sub="这里会说明发生了什么以及下一步。" />
        <StatusBanner title="需要处理" sub="这里会说明当前状态和后续动作。" />
        <Checklist items={[{ label: "资料", detail: "这里会说明资料还缺什么。", state: "pending" }]} />
        <InlineConfirm title="确认操作" sub="这里会说明操作影响。" onConfirm={() => undefined} onCancel={() => undefined} />
        <Spinner label="正在加载，请稍候。" />
      </>,
    );

    expect(html).toContain("font-sans text-sm leading-6");
    expect(html).toContain("text-[var(--color-fg-secondary)]");
    expect(html).not.toContain("font-mono text-[11px]");
  });
});
