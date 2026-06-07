"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { importDemoPackage } from "@/actions/demo-import";

interface Props {
  mapId: string;
  mapName: string;
}

export function DemoImportPanel({ mapId, mapName }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [importing, setImporting] = useState(false);

  async function handleImport() {
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
      const result = await importDemoPackage(mapId, buf);

      if (!result.success) {
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
      router.refresh();
    } catch {
      toast.error("导入失败，请检查文件格式");
    } finally {
      setImporting(false);
    }
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
          onClick={() => handleImport()}
          disabled={importing}
        >
          {importing ? "导入中…" : "导入 Demo 数据"}
        </Button>
      </div>

    </div>
  );
}
