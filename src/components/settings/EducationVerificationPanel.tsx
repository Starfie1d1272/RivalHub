"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { declareInstitutionalEmailEducation, getInstitutionSearch, submitEducationVerification } from "@/actions/education-verifications";
import { resendCurrentEmailVerification } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checklist, Panel, StatusBanner } from "@/components/rivalhub";

type Verification = { id: string; institution: string; code: string | null; academicStatus: "enrolled" | "graduated"; evidenceType: string; status: "pending" | "approved" | "rejected"; reviewNote: string | null; submittedAt: string };
type Institution = { id: string; name: string; code: string | null; province: string | null };
const statusLabel = { pending: "待审核", approved: "已认证", rejected: "已驳回" };

export function EducationVerificationPanel({ email, emailVerified, hasInstitutionalFastPath, verifications }: { email: string; emailVerified: boolean; hasInstitutionalFastPath: boolean; verifications: Verification[] }) {
  const [pending, startTransition] = useTransition();
  const [academicStatus, setAcademicStatus] = useState<"enrolled" | "graduated">("enrolled");
  const [query, setQuery] = useState("");
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [evidenceCode, setEvidenceCode] = useState("");
  const run = (fn: () => Promise<{ success: boolean; error?: { message: string } }>, message: string) => startTransition(async () => { const result = await fn(); if (result.success) toast.success(message); else toast.error(result.error?.message ?? "操作失败，请稍后重试"); });
  const search = () => run(async () => { const result = await getInstitutionSearch(query); if (result.success) setInstitutions(result.data); return result; }, "已更新学校搜索结果");

  return <div className="space-y-5">
    <StatusBanner tone={emailVerified ? "success" : "warn"} title={emailVerified ? "邮箱已验证" : "邮箱尚未验证"} sub={emailVerified ? `${email} 已完成邮箱所有权验证。` : "请先验证当前账号邮箱，验证后才能参加新的赛事报名或提交教育认证。"} />
    {!emailVerified && <Button disabled={pending} onClick={() => run(resendCurrentEmailVerification, "验证邮件已发送，请打开邮件完成验证")}>验证当前邮箱</Button>}
    {emailVerified && hasInstitutionalFastPath && <Panel label="1 · 南京大学学生邮箱快速认证" pad={20}><div className="space-y-4"><p className="text-sm leading-6 text-[var(--color-fg-mid)]">当前邮箱精确匹配南京大学学生邮箱。选择教育身份后即可走快速认证；不适用时可使用下方学信网或人工审核路径。</p><div className="flex flex-wrap gap-2"><Button variant={academicStatus === "enrolled" ? "default" : "outline"} onClick={() => setAcademicStatus("enrolled")}>在读</Button><Button variant={academicStatus === "graduated" ? "default" : "outline"} onClick={() => setAcademicStatus("graduated")}>已毕业</Button></div><Button disabled={pending} onClick={() => run(() => declareInstitutionalEmailEducation({ academicStatus }), "南京大学学校邮箱已认证")}>确认教育身份</Button></div></Panel>}
    {emailVerified && <Panel label={hasInstitutionalFastPath ? "2 · 学信网材料人工审核" : "教育身份认证"} pad={20}><div className="space-y-4"><p className="text-sm leading-6 text-[var(--color-fg-mid)]">无法使用南京大学学生邮箱的选手，请在学信档案申请在线验证报告。平台只会将报告中的在线验证码提供给超级管理员在学信网核验，不会公开展示，也不会保存学信网账号。</p><a className="inline-flex text-sm underline" href="https://my.chsi.com.cn/archive/index.jsp" target="_blank" rel="noreferrer">前往学信档案申请在线验证报告</a><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索教育部高校目录" /><Button variant="outline" disabled={pending || !query.trim()} onClick={search}>搜索高校</Button></div>{institutions.length > 0 && <div className="max-h-44 divide-y divide-[var(--color-border)] overflow-auto border border-[var(--color-border)]">{institutions.map((item) => <Button type="button" key={item.id} variant="ghost" onClick={() => { setInstitution(item); setInstitutions([]); }} className="h-auto w-full justify-start px-3 py-2 text-left text-sm">{item.name} {item.province ? `· ${item.province}` : ""}</Button>)}</div>}{institution && <StatusBanner tone="info" title={`已选择：${institution.name}`} sub={institution.code ? `高校代码 ${institution.code}` : "请继续选择教育身份与在线验证材料。"} />}<div className="flex flex-wrap gap-2"><Button variant={academicStatus === "enrolled" ? "default" : "outline"} onClick={() => setAcademicStatus("enrolled")}>在读</Button><Button variant={academicStatus === "graduated" ? "default" : "outline"} onClick={() => setAcademicStatus("graduated")}>已毕业</Button></div><StatusBanner tone="info" title={academicStatus === "enrolled" ? "需要《教育部学籍在线验证报告》" : "需要《教育部学历证书电子注册备案表》"} sub="复制报告中的在线验证码（通常为 16 位）；管理员会在学信网官方验证系统人工核验。" /><div className="space-y-1.5"><Label htmlFor="chsi-evidence-code">学信网在线验证码</Label><Input id="chsi-evidence-code" value={evidenceCode} onChange={(event) => setEvidenceCode(event.target.value)} placeholder="请输入报告中的在线验证码" autoComplete="off" /></div><Button disabled={pending || !institution || !evidenceCode.trim()} onClick={() => run(() => submitEducationVerification({ institutionId: institution?.id, academicStatus, evidenceCode }), "教育认证已提交，等待管理员审核")}>提交认证材料</Button></div></Panel>}
    <Panel label="认证记录" pad={0}>
      {verifications.length === 0 ? <p className="p-5 text-sm text-[var(--color-fg-mid)]">尚无教育认证记录。</p> : <Checklist items={verifications.map((item) => ({
        label: `${item.institution} · ${item.academicStatus === "enrolled" ? "在读" : "已毕业"} · ${statusLabel[item.status]}`,
        detail: item.status === "rejected" && item.reviewNote ? `审核说明：${item.reviewNote}` : `提交于 ${item.submittedAt}`,
        state: item.status === "approved" ? "complete" as const : item.status === "rejected" ? "blocked" as const : "pending" as const,
      }))} />}
    </Panel>
    <p className="text-xs text-[var(--color-fg-mid)]">赛事报名需要邮箱已验证和已认证教育身份。<Link className="underline" href="/">返回首页</Link></p>
  </div>;
}
