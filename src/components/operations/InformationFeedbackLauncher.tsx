"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { submitFeedback } from "@/actions/feedback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownDocument } from "@/components/content/MarkdownDocument";
import type { PublicAnnouncement } from "@/lib/announcements/presentation";
import { FEEDBACK_CATEGORY_LABELS, type FeedbackCategory } from "@/lib/feedback/validation";
import { activeGroupCount, type PublicSeasonInfo } from "@/lib/season-public-info/presentation";

const ACK_PREFIX = "rivalhub:announcement-ack:";

type Props = {
  latestAnnouncement: PublicAnnouncement | null;
  attentionAnnouncement: PublicAnnouncement | null;
  season?: { id: string; slug: string } | null;
  seasonInfo?: PublicSeasonInfo | null;
};

export function InformationFeedbackLauncher(props: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [attentionAnnouncement, setAttentionAnnouncement] = useState<PublicAnnouncement | null>(props.attentionAnnouncement);
  const [launcherPulse, setLauncherPulse] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!props.attentionAnnouncement || isAcknowledged(props.attentionAnnouncement)) {
        setAttentionAnnouncement(null);
      } else {
        setAttentionAnnouncement(props.attentionAnnouncement);
        setAttentionOpen(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [props.attentionAnnouncement]);

  if (pathname.startsWith("/admin")) return null;

  const acknowledged = props.latestAnnouncement ? isAcknowledged(props.latestAnnouncement) : false;
  const markAcknowledged = (announcement: PublicAnnouncement | null) => {
    if (!announcement) return;
    try {
      window.localStorage.setItem(ACK_PREFIX + announcement.id, announcement.updatedAt);
    } catch {
      /* local storage is optional */
    }
    if (attentionAnnouncement?.id === announcement.id) setAttentionAnnouncement(null);
    setAttentionOpen(false);
    setLauncherPulse(true);
    window.setTimeout(() => setLauncherPulse(false), 240);
  };

  return (
    <>
      <button
        type="button"
        aria-label="信息与反馈"
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen(true)}
        className={`fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-[var(--z-sticky)] inline-flex size-11 items-center justify-center rounded-sm border border-[var(--color-border-static)] bg-[var(--color-surface-floating)] text-[var(--color-fg-primary)] shadow-lg transition-transform duration-[var(--duration-normal)] hover:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] motion-reduce:transition-none motion-reduce:scale-100 ${launcherPulse ? "scale-110" : ""}`}
      >
        <Info className="size-5" />
        {(attentionAnnouncement || (!acknowledged && Boolean(props.latestAnnouncement))) && (
          <span aria-label="有新公告" className="absolute -right-1 -top-1 size-3 rounded-full bg-[var(--color-accent)] ring-2 ring-[var(--color-surface-floating)]" />
        )}
      </button>

      <Dialog open={panelOpen} onOpenChange={setPanelOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>信息与反馈</DialogTitle>
            <DialogDescription>找到最新信息，也可以告诉我们使用中遇到的问题。</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            <section className="space-y-2">
              <h2 className="font-semibold text-[var(--color-fg-primary)]">最新公告</h2>
              {props.latestAnnouncement ? (
                <>
                  <p className="text-sm font-medium text-[var(--color-fg-primary)]">{props.latestAnnouncement.title}</p>
                  <p className="text-xs text-[var(--color-fg-secondary)]">{props.latestAnnouncement.scopeLabel} · {new Date(props.latestAnnouncement.publishedAt).toLocaleDateString("zh-CN")}</p>
                  <Link
                    href={props.season ? `/${props.season.slug}/announcements` : "/announcements"}
                    className="inline-flex text-sm text-[var(--color-accent)] hover:underline"
                    onClick={() => setPanelOpen(false)}
                  >
                    查看全部公告 →
                  </Link>
                </>
              ) : (
                <p className="text-sm text-[var(--color-fg-secondary)]">暂时没有新的公告。</p>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="font-semibold text-[var(--color-fg-primary)]">赛事信息</h2>
              {props.season && props.seasonInfo ? (
                <>
                  <div className="flex flex-wrap gap-2 text-sm text-[var(--color-fg-secondary)]">
                    <Link href={`/${props.season.slug}/info`} onClick={() => setPanelOpen(false)} className="text-[var(--color-accent)] hover:underline">
                      {props.seasonInfo.rules.label}
                    </Link>
                    <span>·</span>
                    <Link href={`/${props.season.slug}/info`} onClick={() => setPanelOpen(false)} className="text-[var(--color-accent)] hover:underline">
                      交流群（{activeGroupCount(props.seasonInfo)} 个）
                    </Link>
                    <span>·</span>
                    <Link href={`/${props.season.slug}/info`} onClick={() => setPanelOpen(false)} className="text-[var(--color-accent)] hover:underline">
                      联系方式
                    </Link>
                  </div>
                  <Link href={`/${props.season.slug}/info`} onClick={() => setPanelOpen(false)} className="inline-flex text-sm text-[var(--color-accent)] hover:underline">
                    查看完整赛事信息 →
                  </Link>
                </>
              ) : (
                <Link href="/seasons" onClick={() => setPanelOpen(false)} className="inline-flex text-sm text-[var(--color-accent)] hover:underline">
                  浏览正在进行与历史赛事 →
                </Link>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="font-semibold text-[var(--color-fg-primary)]">遇到问题？</h2>
              <p className="text-sm text-[var(--color-fg-secondary)]">向 RivalHub 团队提交功能反馈或体验问题。</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPanelOpen(false);
                  setFeedbackOpen(true);
                }}
              >
                提交反馈
              </Button>
            </section>
          </DialogBody>
        </DialogContent>
      </Dialog>

      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <FeedbackDialog pathname={pathname} seasonId={props.season?.id ?? null} />
      </Dialog>

      <Dialog open={attentionOpen} onOpenChange={(open) => { if (!open) markAcknowledged(attentionAnnouncement); }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>重要提醒</DialogTitle>
            <DialogDescription>{attentionAnnouncement?.scopeLabel ?? "RivalHub"}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-lg font-semibold text-[var(--color-fg-primary)]">{attentionAnnouncement?.title}</p>
            <div className="mt-3 text-sm leading-7 text-[var(--color-fg-secondary)]">
              <MarkdownDocument>{attentionAnnouncement?.body ?? ""}</MarkdownDocument>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => markAcknowledged(attentionAnnouncement)}>知道了，收进入口</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FeedbackDialog({ pathname, seasonId }: { pathname: string; seasonId: string | null }) {
  const [category, setCategory] = useState<FeedbackCategory>("problem");
  const [body, setBody] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [pending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);

  function submit() {
    startTransition(async () => {
      const result = await submitFeedback({ category, body, pathname, seasonId, honeypot });
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setSubmitted(true);
      setBody("");
      toast.success("反馈已提交");
    });
  }

  return (
    <DialogContent size="md">
      <DialogHeader>
        <DialogTitle>提交反馈</DialogTitle>
        <DialogDescription>反馈会用于改进 RivalHub。若问题需要及时回复或赛事现场协助，请通过对应赛事交流群 / 联系方式联系赛委会。</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {submitted ? (
          <div className="border border-[var(--color-border)] bg-[var(--color-panel-low)] p-4 text-sm text-[var(--color-fg-secondary)]">
            反馈已提交，谢谢你的帮助。我们不保证逐条回复。
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label htmlFor="feedback-category" className="text-sm font-medium">反馈类型</label>
              <select
                id="feedback-category"
                value={category}
                onChange={(event) => setCategory(event.target.value as FeedbackCategory)}
                className="h-10 w-full border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm"
              >
                {Object.entries(FEEDBACK_CATEGORY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="feedback-body" className="text-sm font-medium">反馈内容</label>
              <Textarea
                id="feedback-body"
                value={body}
                maxLength={4000}
                rows={7}
                placeholder="请描述你遇到的情况……"
                onChange={(event) => setBody(event.target.value)}
              />
            </div>
            <div className="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden="true">
              <label htmlFor="feedback-website">网站</label>
              <input
                id="feedback-website"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(event) => setHoneypot(event.target.value)}
              />
            </div>
          </>
        )}
      </DialogBody>
      <DialogFooter>
        {submitted ? (
          <Button onClick={() => setSubmitted(false)}>继续提交</Button>
        ) : (
          <Button disabled={pending || !body.trim()} onClick={submit}>
            {pending ? "提交中…" : "提交反馈"}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

function isAcknowledged(announcement: PublicAnnouncement): boolean {
  try {
    return window.localStorage.getItem(ACK_PREFIX + announcement.id) === announcement.updatedAt;
  } catch {
    return false;
  }
}
