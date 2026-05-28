"use client";

export default function MatchDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="rounded-xl bg-red-900/10 border border-red-900/20 p-8 text-center space-y-4">
        <div className="text-4xl">⚠️</div>
        <h2 className="text-lg font-semibold text-[var(--color-fg)]">加载比赛详情失败</h2>
        <p className="text-sm text-[var(--color-fg-mid)]">
          {error.message || "服务器内部错误，请稍后重试。"}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg text-sm font-medium
            bg-[var(--color-accent)] text-white
            hover:brightness-110 transition-all"
        >
          重试
        </button>
      </div>
    </div>
  );
}
