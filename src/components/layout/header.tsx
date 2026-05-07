// TODO: 实现多赛季导航 Header
// - 从 DB 查询所有非 archived 赛季（Server Component）
// - 当前赛季高亮（通过 usePathname 或 params 判断）
// - Draft 赛季显示"敬请期待"badge
// - 移动端折叠为 hamburger 菜单（"use client" 子组件）

export function Header() {
  return (
    <header className="border-b border-[var(--border)] bg-[var(--bg-elevated)]">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between">
        <span className="font-bold text-[var(--text-primary)]">NJU CS2</span>
        {/* TODO: 赛季导航链接 */}
      </div>
    </header>
  );
}
