type Downloads = { windows: string; macos: string; windowsZip?: string } | null;

export function MatchDownloads({ downloads }: { downloads: Downloads }) {
  const linkClass = "text-[var(--color-accent)] underline underline-offset-4";
  return <div className="grid gap-4 border-t border-[var(--color-border)] pt-3 sm:grid-cols-2 text-sm">
    <section className="space-y-2">
      <h3 className="font-medium">Mizar</h3>
      <p>现场制播、HUD 与实时比赛采集；安装后连接 RivalHub。</p>
      <div className="flex flex-wrap gap-4">
        <a className={linkClass} href="https://box.nju.edu.cn/d/91dec4c27e5d47f38fcf/?p=/Downloads" target="_blank" rel="noreferrer">下载 Windows Mizar ↗</a>
        <a className={linkClass} href="https://github.com/Starfie1d1272/Mizar/releases" target="_blank" rel="noreferrer">历史版本与发布说明 ↗</a>
      </div>
    </section>
    <section className="space-y-2">
      <h3 className="font-medium">DAK Demo Uploader</h3>
      <p>去 Perfect 下载 Demo，在本地解析后同步赛后分析结果。</p>
      <div className="flex flex-wrap gap-4">
        {downloads ? <>
          <a className={linkClass} href={downloads.windows}>{downloads.windowsZip ? "Windows 安装包（推荐）" : "Windows 完整 ZIP"}</a>
          {downloads.windowsZip && <a className={linkClass} href={downloads.windowsZip}>Windows 完整 ZIP（备用）</a>}
          <a className={linkClass} href={downloads.macos}>下载 macOS Uploader</a>
        </> : <a className={linkClass} href="https://github.com/Starfie1d1272/cs2-demo-analysis-kit/releases/latest" target="_blank" rel="noreferrer">获取 RivalHub Demo Uploader ↗</a>}
      </div>
      {downloads && <p className="text-[var(--color-fg-mid)]">ZIP 请完整解压并保留目录结构，再运行其中的程序。</p>}
    </section>
  </div>;
}
