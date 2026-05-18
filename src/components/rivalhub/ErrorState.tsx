import { Btn } from "./Btn";

interface ErrorStateProps {
  code?: string;
  title?: string;
  sub?: string;
  onRetry?: () => void;
}

export function ErrorState({
  code = "ERR_500",
  title = "出错了",
  sub,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="py-10 px-6 text-center">
      <div
        className="inline-flex items-center gap-2 px-2.5 py-1 mb-3.5 rounded-sm border"
        style={{
          borderColor: "#ff547055",
          background: "#ff547010",
          color: "#ff5470",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "var(--tracking-label)",
        }}
      >
        ● {code}
      </div>
      <div
        className="font-semibold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          color: "var(--color-fg)",
          letterSpacing: "var(--tracking-tight-1)",
        }}
      >
        {title}
      </div>
      {sub && (
        <div
          className="mt-2 mx-auto max-w-[460px] leading-relaxed"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-fg-mid)",
            letterSpacing: "var(--tracking-ticker)",
          }}
        >
          {sub}
        </div>
      )}
      {onRetry && (
        <div className="mt-4.5 flex justify-center gap-2">
          <Btn primary onClick={onRetry}>
            ↻ 重试
          </Btn>
        </div>
      )}
    </div>
  );
}
