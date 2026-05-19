import { Btn } from "./Btn";

interface InlineConfirmProps {
  title: string;
  sub?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function InlineConfirm({
  title,
  sub,
  danger,
  onConfirm,
  onCancel,
}: InlineConfirmProps) {
  const c = danger ? "var(--color-danger)" : "var(--color-warn)";
  return (
    <div
      className="grid gap-3 items-center rounded-sm border px-4 py-3"
      style={{
        gridTemplateColumns: "1fr auto",
        background: `color-mix(in srgb, ${c} 5%, transparent)`,
        borderColor: `color-mix(in srgb, ${c} 33%, transparent)`,
        borderLeft: `3px solid ${c}`,
      }}
    >
      <div>
        <div
          className="font-semibold"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            color: "var(--color-fg)",
          }}
        >
          {title}
        </div>
        {sub && (
          <div
            className="mt-1"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-fg-mid)",
            }}
          >
            {sub}
          </div>
        )}
      </div>
      <div className="flex gap-1.5">
        <Btn ghost small onClick={onCancel}>
          取消
        </Btn>
        <Btn small danger={danger} primary={!danger} onClick={onConfirm}>
          {danger ? "确认删除" : "确认"}
        </Btn>
      </div>
    </div>
  );
}
