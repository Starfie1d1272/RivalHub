import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { demoAnalysisRuns, demoImports } from "@/db/schema";
import { createServiceClient } from "@/lib/auth/supabase";

const DEMO_BUCKET = "demo-imports";

/**
 * GET /api/dak/workspace/[mapId]/replay
 *
 * 从 Supabase Storage 中的完整 workspace JSON 按需返回 replay 数据。
 * 数据库只保存紧凑 workspace（不含逐帧 replay），
 * 完整 workspace（含 replay rounds）在导入时同步上传到 Storage。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  try {
    const { mapId } = await params;

    const [row] = await db
      .select({
        zipObjectPath: demoImports.zipObjectPath,
      })
      .from(demoImports)
      .innerJoin(demoAnalysisRuns, eq(demoAnalysisRuns.importId, demoImports.id))
      .where(and(
        eq(demoImports.mapId, mapId),
        eq(demoImports.isCurrent, true),
        eq(demoAnalysisRuns.status, "ready"),
      ))
      .orderBy(desc(demoAnalysisRuns.completedAt))
      .limit(1);

    if (!row?.zipObjectPath) {
      return NextResponse.json({ error: "DAK workspace 未找到" }, { status: 404 });
    }

    const workspacePath = row.zipObjectPath.replace(/\.zip$/, "-workspace.json");
    const { data, error } = await createServiceClient()
      .storage
      .from(DEMO_BUCKET)
      .download(workspacePath);

    if (error || !data) {
      return NextResponse.json({ error: "完整 workspace JSON 未找到，请重新导入 Demo" }, { status: 404 });
    }

    const full = JSON.parse(await data.text());
    const replay = full?.replay;

    if (!replay) {
      return NextResponse.json({ error: "workspace 中无 replay 数据" }, { status: 404 });
    }

    return NextResponse.json({
      replay,
      _meta: { mapId, source: "supabase-storage" },
    });
  } catch (error) {
    console.error("DAK replay API error:", error);
    return NextResponse.json({ error: "获取 replay 失败" }, { status: 500 });
  }
}
