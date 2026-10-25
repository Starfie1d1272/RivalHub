import React from "react";
import { Panel } from "@/components/rivalhub";

export function PrivacyContent() {
  return <>
    <Panel label="公开赛事资料" contentClassName="p-6"><p className="text-sm text-[var(--color-fg-mid)]">为组织和公开展示赛事，RivalHub 可以展示昵称、公开游戏平台身份、自行申报的竞技档案、比赛数据/战绩和赛事荣誉，以及允许公开的高校认证状态或学校信息。</p></Panel>
    <Panel label="默认仅赛事管理可见" contentClassName="p-6"><p className="text-sm text-[var(--color-fg-mid)]">邮箱、QQ、学信网与教育认证原始材料、人工审核材料、投诉证据、纪律调查内部材料，以及审计和安全信息，不向普通用户公开。</p></Panel>
    <Panel label="使用与性能分析" contentClassName="p-6"><p className="text-sm text-[var(--color-fg-mid)]">为改善页面速度与关键操作体验，平台在启用时记录页面模板、操作结果、任务步骤、固定校验原因、页面可见且近期交互的活跃用时，以及性能指标和设备、浏览器、系统、来源的粗分类。采集不包含表单正文。登录账号使用产品专用假名标识，原始遥测采用七天保留策略，限获授权的管理员查询。长期趋势在单独启用后保存不含账号与会话标识的日汇总，保留期由启用配置确定，上限九十天；恢复副本按服务商恢复窗口管理。采集遵循浏览器的 Do Not Track 和 Global Privacy Control 设置。</p></Panel>
    <Panel label="参赛确认" contentClassName="p-6"><p className="text-sm text-[var(--color-fg-mid)]">创建报名队伍或确认加入前，选手须阅读并同意赛事规则及本说明。平台仅处理组织赛事、身份与公平审核、比赛统计及安全运行所必要的数据；不会承诺当前系统未实现的自动删除机制。</p></Panel>
  </>;
}
