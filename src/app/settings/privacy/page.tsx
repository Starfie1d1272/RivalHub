import Link from "next/link";
import { Marker, Panel } from "@/components/rivalhub";

export default function SettingsPrivacyPage() {
  return <div className="space-y-6"><Marker sub="NJU Major · 2026 年 8 月修订版">隐私与数据使用说明</Marker><Panel label="公开赛事资料" pad={24}><p className="text-sm text-[var(--color-fg-mid)]">为组织和公开展示赛事，RivalHub 可以展示展示昵称、公开游戏平台身份、自行申报的竞技档案、比赛数据/战绩和赛事荣誉，以及允许公开的高校认证状态或学校信息。</p></Panel><Panel label="默认仅赛事管理可见" pad={24}><p className="text-sm text-[var(--color-fg-mid)]">邮箱、QQ、学信网与教育认证原始材料、人工审核材料、投诉证据、纪律调查内部材料，以及审计和安全信息，不向普通用户公开。</p></Panel><Panel label="参赛确认" pad={24}><p className="text-sm text-[var(--color-fg-mid)]">创建报名队伍或确认加入前，选手须阅读并同意赛事规则及本说明。平台仅处理组织赛事、身份与公平审核、比赛统计及安全运行所必要的数据；不会承诺当前系统未实现的自动删除机制。</p><Link className="mt-3 inline-block text-sm underline" href="/">返回首页</Link></Panel></div>;
}
