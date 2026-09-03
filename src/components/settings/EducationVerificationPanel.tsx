"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { declareInstitutionalEmailEducation, getInstitutionSearch, submitEducationVerification, type EducationSubmissionOutcome } from "@/actions/education-verifications";
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
  const run = <T,>(fn: () => Promise<{ success: true; data: T } | { success: false; error: { message: string } }>, message: string | ((data: T) => string)) => startTransition(async () => { const result = await fn(); if (result.success) toast.success(typeof message === "function" ? message(result.data) : message); else toast.error(result.error.message ?? "操作失败，请稍后重试"); });
  const search = () => run(async () => { const result = await getInstitutionSearch(query); if (result.success) setInstitutions(result.data); return result; }, "已更新学校搜索结果");
  const selectInstitution = (item: Institution) => { setInstitution(item); setQuery(item.name); setInstitutions([]); };
  const resetInstitution = () => { setInstitution(null); setInstitutions([]); };

  return <div className="space-y-5">
    <StatusBanner tone={emailVerified ? "success" : "warn"} title={emailVerified ? "邮箱已验证" : "邮箱尚未验证"} sub={emailVerified ? `${email} 已完成邮箱所有权验证。` : "请先验证当前账号邮箱，验证后才能参加新的赛事报名或提交教育认证。"} />
    {!emailVerified && <Button disabled={pending} onClick={() => run(resendCurrentEmailVerification, "验证邮件已发送，请打开邮件完成验证")}>验证当前邮箱</Button>}
    {emailVerified && hasInstitutionalFastPath && <Panel label="1 · 南京大学学生邮箱快速认证" pad={20}><div className="space-y-4"><p className="text-sm leading-6 text-[var(--color-fg-mid)]">当前邮箱精确匹配南京大学学生邮箱。选择教育身份后即可走快速认证；不适用时可使用下方学信网或人工审核路径。</p><div className="flex flex-wrap gap-2"><Button variant={academicStatus === "enrolled" ? "default" : "outline"} onClick={() => setAcademicStatus("enrolled")}>在读</Button><Button variant={academicStatus === "graduated" ? "default" : "outline"} onClick={() => setAcademicStatus("graduated")}>已毕业</Button></div><Button disabled={pending} onClick={() => run(() => declareInstitutionalEmailEducation({ academicStatus }), "南京大学学校邮箱已认证")}>确认教育身份</Button></div></Panel>}
    {emailVerified && <Panel label={hasInstitutionalFastPath ? "2 · 学信网材料人工审核" : "教育身份认证"} pad={20}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-[var(--color-fg-mid)]">无法使用南京大学学生邮箱的选手，请在学信档案申请在线验证报告。平台只会将报告中的在线验证码提供给超级管理员在学信网核验，不会公开展示，也不会保存学信网账号。</p>
        <a className="inline-flex text-sm underline" href="https://my.chsi.com.cn/archive/index.jsp" target="_blank" rel="noreferrer">前往学信档案申请在线验证报告</a>
        {institution ? <div className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <Label>学校</Label>
              <p className="text-xs text-[var(--color-fg-mid)]">已从教育部高校目录选择</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={resetInstitution}>重新选择</Button>
          </div>
          <div role="status" aria-live="polite" className="flex items-start gap-2 rounded-sm border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3 py-3">
            <span aria-hidden className="mt-0.5 font-mono text-sm font-bold text-[var(--color-accent)]">✓</span>
            <div className="min-w-0">
              <p className="font-semibold text-[var(--color-fg)]">{institution.name}</p>
              <p className="mt-0.5 text-xs text-[var(--color-fg-mid)]">{institution.province ?? "地区未提供"}{institution.code ? ` · 高校代码 ${institution.code}` : ""}</p>
            </div>
          </div>
        </div> : <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="institution-search">学校</Label>
            <p id="institution-search-hint" className="text-xs leading-5 text-[var(--color-fg-mid)]">输入学校名称，并从教育部高校目录搜索结果中选择</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input id="institution-search" aria-describedby="institution-search-hint" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：南京大学" />
            <Button variant="outline" disabled={pending || !query.trim()} onClick={search}>搜索高校</Button>
          </div>
          {institutions.length > 0 && <div className="overflow-hidden rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)]">
            <p className="border-b border-[var(--color-border)] px-3 py-2 font-mono text-[11px] text-[var(--color-fg-mid)]">请选择搜索结果中的学校</p>
            <div className="max-h-56 overflow-auto divide-y divide-[var(--color-border)]">
              {institutions.map((item) => <Button type="button" key={item.id} variant="ghost" onClick={() => selectInstitution(item)} className="h-auto w-full justify-start rounded-none px-3 py-2.5 text-left hover:bg-[var(--color-panel-hi)] focus-visible:bg-[var(--color-panel-hi)]">
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate font-semibold text-[var(--color-fg)]">{item.name}</span>
                  <span className="text-xs font-normal text-[var(--color-fg-mid)]">{item.province ?? "地区未提供"}{item.code ? ` · 高校代码 ${item.code}` : ""}</span>
                </span>
              </Button>)}
            </div>
          </div>}
        </div>}
        <div className="flex flex-wrap gap-2"><Button variant={academicStatus === "enrolled" ? "default" : "outline"} onClick={() => setAcademicStatus("enrolled")}>在读</Button><Button variant={academicStatus === "graduated" ? "default" : "outline"} onClick={() => setAcademicStatus("graduated")}>已毕业</Button></div>
        <StatusBanner tone="info" title={academicStatus === "enrolled" ? "需要《教育部学籍在线验证报告》" : "需要《教育部学历证书电子注册备案表》"} sub="复制报告中的在线验证码（通常为 16 位）；管理员会在学信网官方验证系统人工核验。" />
        <div className="space-y-1.5"><Label htmlFor="chsi-evidence-code">学信网在线验证码</Label><Input id="chsi-evidence-code" value={evidenceCode} onChange={(event) => setEvidenceCode(event.target.value)} placeholder="请输入报告中的在线验证码" autoComplete="off" /></div>
        <Button disabled={pending || !institution || !evidenceCode.trim()} onClick={() => run<EducationSubmissionOutcome>(() => submitEducationVerification({ institutionId: institution?.id, academicStatus, evidenceCode }), (outcome) => outcome === "created" ? "教育认证已提交，等待管理员审核" : outcome === "already_pending" ? "该验证码已提交，正在等待管理员审核" : "该验证码已通过审核，无需重复提交")}>提交认证材料</Button>
      </div>
    </Panel>}
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
