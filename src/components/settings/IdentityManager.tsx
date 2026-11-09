"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  requestSecondaryEmailIdentity as telemetry_requestSecondaryEmailIdentity,
  revokeSecondaryEmailIdentity as telemetry_revokeSecondaryEmailIdentity,
} from "@/actions/identity";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, StatusBanner } from "@/components/rivalhub";
import { ErrorCode } from "@/lib/errors";
import { observeAction } from "@/lib/telemetry/client";

const requestSecondaryEmailIdentity = observeAction(
  "identity.requestSecondaryEmailIdentity",
  telemetry_requestSecondaryEmailIdentity,
);
const revokeSecondaryEmailIdentity = observeAction(
  "identity.revokeSecondaryEmailIdentity",
  telemetry_revokeSecondaryEmailIdentity,
);

type Identity = { id: string; email: string; primary: boolean; verifiedAt: string };

export function IdentityManager({
  identities, returnTo,
}: { identities: Identity[]; returnTo?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sendGuidance, setSendGuidance] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const [revoking, startRevoking] = useTransition();
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokeGuidance, setRevokeGuidance] = useState<"recheck" | "login" | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (revokeGuidance) noticeRef.current?.focus();
  }, [revokeGuidance]);

  function requestLink() {
    startSending(async () => {
      try {
        const result = await requestSecondaryEmailIdentity(email, returnTo);
        if (!result.success) {
          if (result.error.meta?.outcome === "unknown") setSendGuidance(result.error.message);
          toast.error(result.error.message);
          return;
        }
        setEmail("");
        toast.success("验证邮件请求已提交。完成验证后会绑定身份，或进入重复账号安全预检。");
      } catch {
        setSendGuidance("验证邮件请求结果尚未确认，请先检查邮箱，不要立即重复发送。");
      }
    });
  }

  function revoke(identity: Identity) {
    setRevokeError(null);
    startRevoking(async () => {
      let revoked = false;
      try {
        const result = await revokeSecondaryEmailIdentity(identity.id);
        if (!result.success) {
          if (result.error.code === ErrorCode.INTERNAL_ERROR) {
            setRevokeId(null);
            setRevokeGuidance("recheck");
          } else {
            setRevokeError(result.error.message);
          }
          return;
        }
        revoked = true;
        if (!result.data.localExitCompleted) {
          setRevokeId(null);
          setRevokeGuidance("login");
          return;
        }
        toast.success("备用邮箱已撤销。请用保留的邮箱重新登录。");
        router.replace("/login");
        router.refresh();
      } catch {
        setRevokeId(null);
        setRevokeGuidance(revoked ? "login" : "recheck");
      }
    });
  }

  return (
    <div className="space-y-5">
      <Panel label="已验证的邮箱身份" contentClassName="p-0">
        <div className="divide-y divide-[var(--color-border)]">
          {identities.map((identity) => (
            <div
              key={identity.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="break-all font-medium">{identity.email}</p>
                <p className="mt-1 text-xs text-[var(--color-fg-mid)]">
                  {identity.primary ? "主要邮箱" : "备用已验证邮箱"}
                </p>
              </div>
              {!identity.primary && (
                <AlertDialog
                  open={revokeId === identity.id}
                  onOpenChange={(open) => {
                    if (revoking) return;
                    setRevokeId(open ? identity.id : null);
                    setRevokeError(null);
                  }}
                >
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" disabled={sending || revoking || revokeGuidance !== null}>
                      撤销绑定
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>撤销备用邮箱绑定？</AlertDialogTitle>
                      <AlertDialogDescription>
                        撤销 <strong className="break-all">{identity.email}</strong> 的登录方式后，
                        这个 RivalHub 账号在所有设备上的旧登录都会失效，包括当前设备和用主要邮箱登录的设备。
                        你可以用保留的邮箱重新登录。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    {revokeError && <p role="alert" className="text-sm text-[var(--color-danger)]">{revokeError}</p>}
                    <AlertDialogFooter>
                      <AlertDialogCancel className="min-h-11" disabled={revoking}>取消</AlertDialogCancel>
                      <Button type="button" size="lg" variant="destructive" disabled={revoking} onClick={() => revoke(identity)}>
                        {revoking ? "正在撤销…" : "撤销并退出所有设备"}
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          ))}
        </div>
      </Panel>
      {revokeGuidance && (
        <div ref={noticeRef} tabIndex={-1} className="space-y-3">
          <p role="alert" className="text-sm leading-6 text-[var(--color-fg-mid)]">
            {revokeGuidance === "login"
              ? "备用邮箱已撤销，所有旧登录已失效。当前页面退出尚未完成，请重新登录。"
              : "撤销结果尚未确认。请刷新账号与安全，重新登录后核对邮箱状态，再决定是否继续。"}
          </p>
          {revokeGuidance === "login" ? (
            <Button asChild variant="outline"><Link href="/login">重新登录</Link></Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => window.location.reload()}>核对绑定状态</Button>
          )}
        </div>
      )}
      <div id="secondary-email" className="scroll-mt-6" tabIndex={-1}>
        <Panel label="添加备用邮箱" contentClassName="p-5">
          <div className="space-y-4">
            <StatusBanner
              tone="info"
              title="先证明邮箱控制权"
              sub="验证后可以添加备用邮箱。若该邮箱已属于另一 RivalHub 账号，系统会先显示归并影响，由你决定是否继续。"
            />
            <div className="space-y-1.5">
              <Label htmlFor="secondary-email-input">邮箱</Label>
              <Input
                id="secondary-email-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="student@school.example"
              />
            </div>
            {sendGuidance && (
              <p role="alert" className="text-sm text-[var(--color-danger)]">
                {sendGuidance}
              </p>
            )}
            <Button
              type="button"
              disabled={sending || revoking || revokeGuidance !== null || sendGuidance !== null || !email.trim()}
              onClick={requestLink}
            >
              {sending ? "发送中…" : "发送验证邮件"}
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
