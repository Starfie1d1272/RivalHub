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
  const c = danger ? "#ff5470" : "#ffc44d";
  return (
    <div
      className="grid gap-3 items-center rounded-sm border px-4 py-3"
      style={{
        gridTemplateColumns: "1fr auto",
        background: c + "0d",
        borderColor: c + "55",
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
