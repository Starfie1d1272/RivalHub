"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InlineConfirm } from "@/components/rivalhub";
import { startOfficialMap as telemetry_startOfficialMap } from "@/actions/bet";
import { observeAction } from "@/lib/telemetry/client";

const startOfficialMap = observeAction("bet.startOfficialMap", telemetry_startOfficialMap);

export function OfficialMapStart({
  seasonId,
  matchId,
  mapId,
  mapName,
}: {
  seasonId: string;
  matchId: string;
  mapId: string;
  mapName: string;
}) {
  const [confirm, setConfirm] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  return confirm ? (
    <InlineConfirm
      title={`确认 ${mapName} 已正式开局？`}
      sub="记录实际开图事实，并立即锁定相关盘口。只在对局实际开始后确认。"
      onCancel={() => setConfirm(false)}
      confirmLabel="确认已开局"
      returnFocusRef={triggerRef}
      onConfirm={async () => {
        const result = await startOfficialMap({ seasonId, matchId, mapId });
        if (!result.success) toast.error(result.error.message);
        else {
          setConfirm(false);
          router.refresh();
        }
      }}
    />
  ) : (
    <Button ref={triggerRef} variant="outline" size="sm" onClick={() => setConfirm(true)}>
      确认本图已开局
    </Button>
  );
}
