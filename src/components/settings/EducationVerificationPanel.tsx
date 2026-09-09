"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  declareInstitutionalEmailEducation,
  submitAdmissionNoticeEducation,
  submitEducationVerification,
  type EducationSubmissionOutcome,
} from "@/actions/education-verifications";
import { resendCurrentEmailVerification } from "@/actions/auth";
import { Checklist, Panel, StatusBanner } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EDUCATION_EVIDENCE_ALLOWED_MIME_TYPES,
  EDUCATION_EVIDENCE_MAX_BYTES,
} from "@/lib/education/validation";
import type { ActionResult } from "@/types/action";
import {
  EducationInstitutionSelector,
  type EducationInstitutionOption,
} from "./EducationInstitutionSelector";

type Verification = {
  id: string;
  institution: string;
  code: string | null;
  academicStatus: "enrolled" | "graduated";
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  submittedAt: string;
};
type InstitutionalIdentity = { identityId: string; email: string; institution: string };

const statusLabel = { pending: "待审核", approved: "已认证", rejected: "已驳回" } as const;
const acceptedMimeTypes = EDUCATION_EVIDENCE_ALLOWED_MIME_TYPES.join(",");

function outcomeMessage(outcome: EducationSubmissionOutcome): string {
  if (outcome === "already_pending") return "该学校的教育认证正在等待审核，无需重复提交。";
  if (outcome === "already_approved") return "该学校的教育身份已完成认证，无需重复提交。";
  return "教育认证已提交，等待管理员审核。";
}

export function EducationVerificationPanel({
  email,
  emailVerified,
  institutionalIdentities,
  verifications,
}: {
  email: string;
  emailVerified: boolean;
  institutionalIdentities: InstitutionalIdentity[];
  verifications: Verification[];
}) {
  const [pending, startTransition] = useTransition();
  const [academicStatus, setAcademicStatus] = useState<"enrolled" | "graduated">("enrolled");
  const [chsiInstitution, setChsiInstitution] = useState<EducationInstitutionOption | null>(null);
  const [evidenceCode, setEvidenceCode] = useState("");
  const [institutionalIdentityId, setInstitutionalIdentityId] = useState(institutionalIdentities[0]?.identityId ?? "");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualInstitution, setManualInstitution] = useState<EducationInstitutionOption | null>(null);
  const [manualFile, setManualFile] = useState<File | null>(null);
  const [manualFileError, setManualFileError] = useState<string | null>(null);

  const run = <T,>(fn: () => Promise<ActionResult<T>>, message: string | ((data: T) => string)) => startTransition(async () => {
    const result = await fn();
    if (result.success) toast.success(typeof message === "function" ? message(result.data) : message);
    else toast.error(result.error.message ?? "操作失败，请稍后重试");
  });

  function handleManualFileChange(file: File | null) {
    setManualFile(file);
    if (!file) {
      setManualFileError(null);
    } else if (!(EDUCATION_EVIDENCE_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      setManualFileError("请选择 JPG、PNG 或 WebP 图片。");
    } else if (file.size <= 0 || file.size > EDUCATION_EVIDENCE_MAX_BYTES) {
      setManualFileError("图片必须非空且不超过 5 MiB。");
    } else {
      setManualFileError(null);
    }
  }

  function submitManualEvidence() {
    if (!manualInstitution || !manualFile || manualFileError) return;
    const formData = new FormData();
    formData.set("institutionId", manualInstitution.id);
    formData.set("file", manualFile);
    run(() => submitAdmissionNoticeEducation(formData), outcomeMessage);
  }

  const fastPathLabel = institutionalIdentities.length > 0 ? "1 · 学校邮箱快速认证" : "学校邮箱快速认证";
  const chsiLabel = institutionalIdentities.length > 0 ? "2 · 学信网材料人工审核" : "1 · 学信网材料人工审核";
  const manualLabel = institutionalIdentities.length > 0 ? "3 · 录取通知书人工审核" : "2 · 录取通知书人工审核";

  return <div className="space-y-5">
    <StatusBanner
      tone={emailVerified ? "success" : "warn"}
      title={emailVerified ? "当前登录邮箱已验证" : "当前登录邮箱尚未验证"}
      sub={emailVerified ? `${email} 已完成邮箱所有权验证。其他已验证邮箱不会改变当前登录邮箱的验证状态。` : "请先验证当前登录邮箱，验证后才能参加新的赛事报名或提交教育认证。"}
    />
    {!emailVerified && <Button disabled={pending} onClick={() => run(resendCurrentEmailVerification, "验证邮件已发送，请打开邮件完成验证")}>验证当前邮箱</Button>}

    {emailVerified && institutionalIdentities.length === 0 && <StatusBanner
      tone="info"
      title="可用学校邮箱快速认证"
      sub="如果学校提供已被平台支持的学生专属邮箱，可以先绑定并完成邮箱验证；未支持的邮箱不会自动完成教育认证。"
      action={<Button size="sm" asChild><Link href="/settings/security#secondary-email">绑定学校邮箱</Link></Button>}
    />}

    {emailVerified && institutionalIdentities.length > 0 && <Panel label={fastPathLabel} contentClassName="p-5">
      <div className="space-y-4">
        <p className="text-sm leading-6 text-[var(--color-fg-mid)]">选择当前账号已验证且平台支持的学生邮箱，可直接认证在读身份。</p>
        <div className="space-y-1.5">
          <Label htmlFor="institutional-identity">已验证学生邮箱</Label>
          <select id="institutional-identity" className="w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 py-2 text-sm" value={institutionalIdentityId} onChange={(event) => setInstitutionalIdentityId(event.target.value)}>
            {institutionalIdentities.map((identity) => <option key={identity.identityId} value={identity.identityId}>{identity.email} · {identity.institution}</option>)}
          </select>
        </div>
        <Button disabled={pending || !institutionalIdentityId} onClick={() => run(() => declareInstitutionalEmailEducation({ identityId: institutionalIdentityId }), "已确认在读身份")}>确认在读身份</Button>
      </div>
    </Panel>}

    {emailVerified && <Panel label={chsiLabel} contentClassName="p-5">
      <div className="space-y-4">
        <p className="text-sm leading-6 text-[var(--color-fg-mid)]">需要认证在读或已毕业身份时，可在学信档案申请在线验证报告进行人工审核。平台只会将报告中的在线验证码提供给超级管理员在学信网核验，不会公开展示，也不会保存学信网账号。</p>
        <a className="inline-flex text-sm underline" href="https://my.chsi.com.cn/archive/index.jsp" target="_blank" rel="noreferrer">前往学信档案申请在线验证报告</a>
        <EducationInstitutionSelector idPrefix="chsi-institution" value={chsiInstitution} onChange={setChsiInstitution} disabled={pending} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={academicStatus === "enrolled" ? "default" : "outline"} onClick={() => setAcademicStatus("enrolled")}>在读</Button>
          <Button type="button" variant={academicStatus === "graduated" ? "default" : "outline"} onClick={() => setAcademicStatus("graduated")}>已毕业</Button>
        </div>
        <StatusBanner tone="info" title={academicStatus === "enrolled" ? "需要《教育部学籍在线验证报告》" : "需要《教育部学历证书电子注册备案表》"} sub="复制报告中的在线验证码（通常为 16 位）；管理员会在学信网官方验证系统人工核验。" />
        <div className="space-y-1.5"><Label htmlFor="chsi-evidence-code">学信网在线验证码</Label><Input id="chsi-evidence-code" value={evidenceCode} onChange={(event) => setEvidenceCode(event.target.value)} placeholder="请输入报告中的在线验证码" autoComplete="off" /></div>
        <Button disabled={pending || !chsiInstitution || !evidenceCode.trim()} onClick={() => run(() => submitEducationVerification({ institutionId: chsiInstitution?.id, academicStatus, evidenceCode }), outcomeMessage)}>提交认证材料</Button>
      </div>
    </Panel>}

    {emailVerified && <div className="space-y-3">
      <Button type="button" variant="outline" aria-expanded={manualOpen} aria-controls="education-manual-fallback" onClick={() => setManualOpen((open) => !open)}>{manualOpen ? "收起录取通知书人工审核" : "暂时无法获取学信网材料？"}</Button>
      {manualOpen && <div id="education-manual-fallback"><Panel label={manualLabel} contentClassName="p-5">
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">录取通知书人工审核</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--color-fg-mid)]">此方式仅用于暂时无法获取学信网材料的新生，认证结果固定为在读身份。</p>
          </div>
          <EducationInstitutionSelector idPrefix="manual-institution" value={manualInstitution} onChange={setManualInstitution} disabled={pending} />
          <StatusBanner tone="info" title="认证结果固定为在读身份" sub="仅上传能够证明本人姓名、录取高校与本届入学身份的必要页面。请遮挡身份证号、考生号、条形码 / 二维码等与身份核验无关的信息。" />
          <p className="text-sm leading-6 text-[var(--color-fg-mid)]">材料仅供超级管理员审核；审核完成 7 天后自动删除，不会公开展示。</p>
          <div className="space-y-1.5">
            <Label htmlFor="admission-notice-file">录取通知书图片</Label>
            <Input id="admission-notice-file" type="file" accept={acceptedMimeTypes} onChange={(event) => handleManualFileChange(event.target.files?.[0] ?? null)} disabled={pending} />
            <p className="text-xs leading-5 text-[var(--color-fg-mid)]">仅支持 1 张 JPG、PNG 或 WebP 图片，文件大小不超过 5 MiB。</p>
            {manualFile && !manualFileError && <p className="text-xs text-[var(--color-fg-mid)]">已选择材料：{manualFile.name}</p>}
            {manualFileError && <p role="alert" className="text-xs text-[var(--color-danger)]">{manualFileError}</p>}
          </div>
          <Button disabled={pending || !manualInstitution || !manualFile || Boolean(manualFileError)} onClick={submitManualEvidence}>提交录取通知书</Button>
        </div>
      </Panel></div>}
    </div>}

    <Panel label="认证记录" contentClassName="p-0">
      {verifications.length === 0 ? <p className="p-5 text-sm text-[var(--color-fg-mid)]">尚无教育认证记录。</p> : <Checklist items={verifications.map((item) => ({
        label: `${item.institution} · ${item.academicStatus === "enrolled" ? "在读" : "已毕业"} · ${statusLabel[item.status]}`,
        detail: item.status === "rejected" && item.reviewNote ? `审核说明：${item.reviewNote}` : `提交于 ${item.submittedAt}`,
        state: item.status === "approved" ? "complete" as const : item.status === "rejected" ? "blocked" as const : "pending" as const,
      }))} />}
    </Panel>
    <p className="text-xs text-[var(--color-fg-mid)]">赛事报名需要邮箱已验证和已认证教育身份。<Link className="underline" href="/">返回首页</Link></p>
  </div>;
}
