// TODO: 实现 Footer
// - 社团名称 / 届次
// - GitHub 仓库链接
// - 当前年份版权

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] py-6 mt-auto">
      <div className="container mx-auto px-4 text-center text-sm text-[var(--text-muted)]">
        {/* TODO: 社团信息 + 版权年份 */}
        NJU CS2 社团 · {new Date().getFullYear()}
      </div>
    </footer>
  );
}
