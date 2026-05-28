"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { InlineConfirm } from "@/components/rivalhub";
import { toast } from "sonner";
import { importDemoPackage } from "@/actions/demo-import";

interface Props {
  mapId: string;
  mapName: string;
}

export function DemoImportPanel({ mapId, mapName }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [showOcrConfirm, setShowOcrConfirm] = useState(false);
  const [pendingZip, setPendingZip] = useState<ArrayBuffer | null>(null);

  async function handleImport(confirmOverwriteOcr = false) {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("请先选择 .zip 文件");
      return;
    }
    if (!file.name.endsWith(".zip")) {
      toast.error("仅支持 .zip 格式的 Demo 导出包");
      return;
    }

    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const result = await importDemoPackage(mapId, buf, {
        confirmOverwriteOcr: confirmOverwriteOcr || undefined,
      });

      if (!result.success) {
        if (result.error.code === "OCR_EXISTS_NEEDS_CONFIRM") {
          setPendingZip(buf);
          setShowOcrConfirm(true);
          return;
        }
        toast.error(result.error.message);
        return;
      }

      const u = result.data.unmatched;
      if (u.length > 0) {
        toast(
          `导入成功。${u.length} 名玩家未自动匹配站内用户：${u.join("、")}，请手动处理。`,
          { duration: 8000 },
        );
      } else {
        toast.success("Demo 数据导入成功");
      }

      if (fileRef.current) fileRef.current.value = "";
    } catch {
      toast.error("导入失败，请检查文件格式");
    } finally {
      setImporting(false);
    }
  }

  async function handleConfirmOcrOverwrite() {
    setShowOcrConfirm(false);
    setPendingZip(null);
    await handleImport(true);
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold text-sm">
          {mapName} — Demo 导入
        </h4>
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          className="text-sm"
        />
        <Button
          size="sm"
          onClick={() => handleImport(false)}
          disabled={importing}
        >
          {importing ? "导入中…" : "导入 Demo 数据"}
        </Button>
      </div>

      {showOcrConfirm && (
        <InlineConfirm
          title="该图已有 OCR 数据"
          sub="导入 demo 将以 demo 为准（OCR 数据保留但不参与聚合），确认继续？"
          onConfirm={handleConfirmOcrOverwrite}
          onCancel={() => {
            setShowOcrConfirm(false);
            setPendingZip(null);
          }}
        />
      )}
    </div>
  );
}
