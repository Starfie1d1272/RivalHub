import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MatchDownloads } from "@/components/matches/MatchDownloads";

describe("match download choices", () => {
  it("offers Mizar and the existing Uploader release fallback without inventing an installer", () => {
    render(<MatchDownloads downloads={null} />);
    expect(screen.getByRole("link", { name: "下载 Windows Mizar ↗" })).toHaveAttribute("href", "https://box.nju.edu.cn/d/91dec4c27e5d47f38fcf/?p=/Downloads");
    expect(screen.getByRole("link", { name: "获取 RivalHub Demo Uploader ↗" })).toHaveAttribute("href", "https://github.com/Starfie1d1272/cs2-demo-analysis-kit/releases/latest");
    expect(screen.queryByRole("link", { name: /安装包/ })).not.toBeInTheDocument();
  });
  it("keeps ZIP alongside the recommended installer and macOS", () => {
    render(<MatchDownloads downloads={{ windows: "https://example.test/setup.exe", windowsZip: "https://example.test/app.zip", macos: "https://example.test/app.dmg" }} />);
    expect(screen.getByRole("link", { name: "Windows 安装包（推荐）" })).toHaveAttribute("href", "https://example.test/setup.exe");
    expect(screen.getByRole("link", { name: "Windows 完整 ZIP（备用）" })).toHaveAttribute("href", "https://example.test/app.zip");
    expect(screen.getByRole("link", { name: "下载 macOS Uploader" })).toHaveAttribute("href", "https://example.test/app.dmg");
  });
});
