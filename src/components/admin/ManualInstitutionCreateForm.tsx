"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createManualInstitution } from "@/actions/education-verifications";
import { Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ManualInstitutionCreateForm() {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [province, setProvince] = useState("");

  function submit() {
    startTransition(async () => {
      const result = await createManualInstitution({ name, province });
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      if (result.data.reused) {
        toast.success(`院校目录已存在：${result.data.institution.name}`);
        return;
      }
      toast.success(`已添加到院校目录：${result.data.institution.name}`);
      setName("");
      setProvince("");
    });
  }

  return (
    <Panel label="补充院校目录" contentClassName="p-5">
      <div className="space-y-4">
        <p className="text-sm leading-6 text-[var(--color-fg-mid)]">
          用于处理用户按学信网正式学校名称仍无法检索到学校的情况。添加后，用户即可按该校名搜索并选择；教育认证仍按正常审核流程进行。
        </p>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="manual-institution-name">正式学校名称</Label>
            <Input id="manual-institution-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="按学信网 / 正式学籍材料填写" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-institution-province">省份（可选）</Label>
            <Input id="manual-institution-province" value={province} onChange={(event) => setProvince(event.target.value)} placeholder="例如：江苏" />
          </div>
          <Button type="button" disabled={pending || !name.trim()} onClick={submit}>{pending ? "保存中…" : "添加到目录"}</Button>
        </div>
      </div>
    </Panel>
  );
}
