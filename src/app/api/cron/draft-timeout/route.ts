import { NextResponse } from "next/server";

// TODO: implement auto-pick logic when captain timer expires
// 触发：Vercel Cron 每分钟一次（vercel.json 中配置）
// 安全：通过 Authorization: Bearer ${CRON_SECRET} 验证
// 逻辑：见 docs/draft-flow.md § Vercel Cron 超时自动 pick
export async function GET(_request: Request) {
  // const authHeader = _request.headers.get("authorization");
  // if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // }
  // await autoPick(...);
  return NextResponse.json({ ok: false, error: "not implemented" }, { status: 501 });
}
