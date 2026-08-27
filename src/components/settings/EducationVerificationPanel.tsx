"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { declareInstitutionalEmailEducation, getInstitutionSearch, submitEducationVerification } from "@/actions/education-verifications";
import { resendCurrentEmailVerification } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, StatusBanner } from "@/components/rivalhub";

type Verification = { id: string; institution: string; code: string | null; academicStatus: "enrolled" | "graduated"; evidenceType: string; status: "pending" | "approved" | "rejected"; reviewNote: string | null; submittedAt: string };
type Institution = { id: string; name: string; code: string | null; province: string | null };
const statusLabel = { pending: "待审核", approved: "已认证", rejected: "已驳回" };

export function EducationVerificationPanel({ email, emailVerified, hasInstitutionalFastPath, verifications }: { email: string; emailVerified: boolean; hasInstitutionalFastPath: boolean; verifications: Verification[] }) {
  const [pending, startTransition] = useTransition();
  const [academicStatus, setAcademicStatus] = useState<"enrolled" | "graduated">("enrolled");
  const [query, setQuery] = useState("");
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [evidenceType, setEvidenceType] = useState<"chsi_enrollment_report" | "chsi_education_report">("chsi_enrollment_report");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const run = (fn: () => Promise<{ success: boolean; error?: { message: string } }>, message: string) => startTransition(async () => { const result = await fn(); if (result.success) toast.success(message); else toast.error(result.error?.message ?? "操作失败，请稍后重试"); });
  const search = () => run(async () => { const result = await getInstitutionSearch(query); if (result.success) setInstitutions(result.data); return result; }, "已更新学校搜索结果");

  return <div className="space-y-5">
    <StatusBanner tone={emailVerified ? "success" : "warn"} title={emailVerified ? "邮箱已验证" : "邮箱尚未验证"} sub={emailVerified ? `${email} 已完成邮箱所有权验证。` : "请先验证当前账号邮箱，验证后才能参加新的赛事报名或提交教育认证。"} />
    {!emailVerified && <Button disabled={pending} onClick={() => run(resendCurrentEmailVerification, "验证邮件已发送，请打开邮件完成验证")}>验证当前邮箱</Button>}
    {emailVerified && hasInstitutionalFastPath && <Panel label="南京大学学校邮箱认证" pad={20}><p className="text-sm text-[var(--color-fg-mid)]">当前邮箱为精确匹配的南京大学学生邮箱。请选择你的教育身份后，即可完成南京大学学校邮箱认证。</p><div className="mt-4 flex flex-wrap gap-2"><Button variant={academicStatus === "enrolled" ? "default" : "outline"} onClick={() => setAcademicStatus("enrolled")}>在读</Button><Button variant={academicStatus === "graduated" ? "default" : "outline"} onClick={() => setAcademicStatus("graduated")}>已毕业</Button><Button disabled={pending} onClick={() => run(() => declareInstitutionalEmailEducation({ academicStatus }), "南京大学学校邮箱已认证")}>确认身份</Button></div></Panel>}
    {emailVerified && <Panel label="提交教育认证" pad={20}><div className="space-y-3"><p className="text-sm text-[var(--color-fg-mid)]">非南京大学学生邮箱请提交学信网官方在线验证链接；平台不会保存学信网账号或默认保存 PDF。</p><div className="flex gap-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索教育部高校目录" /><Button variant="outline" disabled={pending || !query.trim()} onClick={search}>搜索</Button></div>{institutions.length > 0 && <div className="max-h-44 space-y-1 overflow-auto rounded border p-2">{institutions.map((item) => <button type="button" key={item.id} onClick={() => { setInstitution(item); setInstitutions([]); }} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-[var(--color-panel-low)]">{item.name} {item.province ? `· ${item.province}` : ""}</button>)}</div>}{institution && <p className="text-sm">已选：{institution.name} {institution.code ? `（${institution.code}）` : ""}</p>}<div className="flex gap-2"><Button variant={academicStatus === "enrolled" ? "default" : "outline"} onClick={() => setAcademicStatus("enrolled")}>在读</Button><Button variant={academicStatus === "graduated" ? "default" : "outline"} onClick={() => setAcademicStatus("graduated")}>已毕业</Button></div><Label>学信网证明类型</Label><select className="w-full rounded border bg-transparent p-2" value={evidenceType} onChange={(event) => setEvidenceType(event.target.value as typeof evidenceType)}><option value="chsi_enrollment_report">学籍在线验证报告</option><option value="chsi_education_report">学历在线验证报告</option></select><Input value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://www.chsi.com.cn/..." /><Button disabled={pending || !institution || !evidenceUrl.trim()} onClick={() => run(() => submitEducationVerification({ institutionId: institution?.id, academicStatus, evidenceType, evidenceUrl }), "教育认证已提交，等待管理员审核")}>提交认证</Button></div></Panel>}
    <Panel label="认证记录" pad={20}>{verifications.length === 0 ? <p className="text-sm text-[var(--color-fg-mid)]">尚无教育认证记录。</p> : <div className="space-y-3">{verifications.map((item) => <div key={item.id} className="rounded border p-3 text-sm"><p className="font-medium">{item.institution} · {item.academicStatus === "enrolled" ? "在读" : "已毕业"} · {statusLabel[item.status]}</p>{item.status === "rejected" && item.reviewNote && <p className="mt-1 text-[var(--color-warn)]">审核说明：{item.reviewNote}</p>}</div>)}</div>}</Panel>
    <p className="text-xs text-[var(--color-fg-mid)]">赛事报名需要邮箱已验证和已认证教育身份。<Link className="underline" href="/">返回首页</Link></p>
  </div>;
}
