/** @vitest-environment jsdom */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrollHint } from "@/components/rivalhub/ScrollHint";

type ResizeObserverCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];

  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }

  observe = vi.fn();
  disconnect = vi.fn();

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function renderScrollHint() {
  const result = render(
    <ScrollHint>
      <div style={{ width: "800px" }}>横向内容</div>
    </ScrollHint>,
  );
  const scrollContainer = result.container.querySelector(".overflow-x-auto");
  if (!(scrollContainer instanceof HTMLDivElement)) throw new Error("ScrollHint 缺少 scroll container。");

  return { ...result, scrollContainer };
}

function setScrollMetrics(
  container: HTMLDivElement,
  metrics: { clientWidth: number; scrollWidth: number; scrollLeft?: number },
) {
  Object.defineProperties(container, {
    clientWidth: { configurable: true, value: metrics.clientWidth },
    scrollWidth: { configurable: true, value: metrics.scrollWidth },
    scrollLeft: { configurable: true, writable: true, value: metrics.scrollLeft ?? 0 },
  });
}

function getHint(container: HTMLElement, side: "left" | "right") {
  return container.querySelector(`[data-scroll-hint="${side}"]`);
}

describe("ScrollHint", () => {
  beforeEach(() => {
    ResizeObserverMock.instances = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not render hints when content does not overflow", () => {
    const result = renderScrollHint();
    setScrollMetrics(result.scrollContainer, { clientWidth: 400, scrollWidth: 400 });
    act(() => ResizeObserverMock.instances[0]?.trigger());

    expect(getHint(result.container, "left")).not.toBeInTheDocument();
    expect(getHint(result.container, "right")).not.toBeInTheDocument();
  });

  it("renders only the right hint at the initial left edge", () => {
    const result = renderScrollHint();
    setScrollMetrics(result.scrollContainer, { clientWidth: 400, scrollWidth: 800, scrollLeft: 0 });
    act(() => ResizeObserverMock.instances[0]?.trigger());

    expect(getHint(result.container, "left")).not.toBeInTheDocument();
    expect(getHint(result.container, "right")).toBeInTheDocument();
  });

  it("renders both hints while scrolled between the edges", () => {
    const result = renderScrollHint();
    setScrollMetrics(result.scrollContainer, { clientWidth: 400, scrollWidth: 800, scrollLeft: 0 });
    act(() => ResizeObserverMock.instances[0]?.trigger());

    result.scrollContainer.scrollLeft = 200;
    fireEvent.scroll(result.scrollContainer);

    expect(getHint(result.container, "left")).toBeInTheDocument();
    expect(getHint(result.container, "right")).toBeInTheDocument();
  });

  it("renders only the left hint at the right edge", () => {
    const result = renderScrollHint();
    setScrollMetrics(result.scrollContainer, { clientWidth: 400, scrollWidth: 800, scrollLeft: 0 });
    act(() => ResizeObserverMock.instances[0]?.trigger());

    result.scrollContainer.scrollLeft = 400;
    fireEvent.scroll(result.scrollContainer);

    expect(getHint(result.container, "left")).toBeInTheDocument();
    expect(getHint(result.container, "right")).not.toBeInTheDocument();
  });

  it("updates both directions when ResizeObserver reports a content-size change", () => {
    const result = renderScrollHint();
    const observer = ResizeObserverMock.instances[0];
    if (!observer) throw new Error("ScrollHint 未注册 ResizeObserver。");

    setScrollMetrics(result.scrollContainer, { clientWidth: 400, scrollWidth: 400 });
    act(() => observer.trigger());
    expect(getHint(result.container, "left")).not.toBeInTheDocument();
    expect(getHint(result.container, "right")).not.toBeInTheDocument();

    setScrollMetrics(result.scrollContainer, { clientWidth: 400, scrollWidth: 800, scrollLeft: 0 });
    act(() => observer.trigger());
    expect(getHint(result.container, "right")).toBeInTheDocument();

    setScrollMetrics(result.scrollContainer, { clientWidth: 400, scrollWidth: 400, scrollLeft: 0 });
    act(() => observer.trigger());
    expect(getHint(result.container, "left")).not.toBeInTheDocument();
    expect(getHint(result.container, "right")).not.toBeInTheDocument();
  });
});
