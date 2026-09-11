"use client";

import Link from "next/link";
import * as React from "react";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { usePathname } from "next/navigation";
import { Info, X } from "lucide-react";
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
  const [ackVersion, setAckVersion] = useState(0);
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const panelTitleId = useId();

  const subscribe = useCallback((onStoreChange: () => void) => {
    window.addEventListener("storage", onStoreChange);
    return () => window.removeEventListener("storage", onStoreChange);
  }, []);

  const acknowledged = useSyncExternalStore(
    subscribe,
    () => {
      // ackVersion dependency ensures local state updates force re-evaluation
      void ackVersion;
      if (!props.latestAnnouncement) return true;
      return isAcknowledged(props.latestAnnouncement);
    },
    () => true // SSR snapshot defaults to true to avoid hydration mismatch
  );

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

  // Click outside to close desktop floating panel
  useEffect(() => {
    if (!panelOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        // Also ensure we didn't click the launcher toggle button
        const target = event.target as HTMLElement;
        if (target.closest("[data-launcher-button]")) return;
        setPanelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPanelOpen(false);
      launcherButtonRef.current?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [panelOpen]);

  if (pathname.startsWith("/admin")) return null;

  const markLatestAcknowledged = () => {
    if (!props.latestAnnouncement) return;
    try {
      window.localStorage.setItem(ACK_PREFIX + props.latestAnnouncement.id, props.latestAnnouncement.updatedAt);
    } catch {
      /* local storage is optional */
    }
    setAckVersion((v) => v + 1);
  };

  const handleOpenPanel = () => {
    const next = !panelOpen;
    if (next) markLatestAcknowledged();
    setPanelOpen(next);
  };

  const handleAttentionAcknowledge = (announcement: PublicAnnouncement | null) => {
    if (!announcement) return;
    try {
      window.localStorage.setItem(ACK_PREFIX + announcement.id, announcement.updatedAt);
    } catch {
      /* local storage is optional */
    }
    setAckVersion((v) => v + 1);
    if (attentionAnnouncement?.id === announcement.id) setAttentionAnnouncement(null);
    setAttentionOpen(false);
    setLauncherPulse(true);
    window.setTimeout(() => setLauncherPulse(false), 240);
  };

  const hasUnread = Boolean(attentionAnnouncement || (!acknowledged && props.latestAnnouncement));

  return (
    <>
      <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-[var(--z-sticky)] group">
        <button
          type="button"
          data-launcher-button
          ref={launcherButtonRef}
          aria-label="信息与反馈"
          aria-expanded={panelOpen}
          aria-controls={panelOpen ? panelId : undefined}
          onClick={handleOpenPanel}
          className={`inline-flex size-11 items-center justify-center rounded-sm border border-[var(--color-border-static)] bg-[var(--color-surface-floating)] text-[var(--color-fg-primary)] shadow-lg transition-transform duration-[var(--duration-normal)] hover:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] motion-reduce:transition-none motion-reduce:scale-100 ${launcherPulse ? "scale-110" : ""}`}
        >
          <Info className="size-5" />
          {hasUnread && (
            <span aria-label="有新公告" className="absolute -right-1 -top-1 size-3 rounded-full bg-[var(--color-accent)] ring-2 ring-[var(--color-surface-floating)]" />
          )}
        </button>

        {/* Lightweight Tooltip on Desktop */}
        <div className="pointer-events-none absolute bottom-full right-0 mb-2 hidden whitespace-nowrap rounded bg-[var(--color-surface-tooltip)] px-2.5 py-1 text-xs text-[var(--color-fg-inverse)] opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 md:block">
          信息与反馈
        </div>
      </div>

      {/* Desktop Anchored Floating Panel & Mobile Sheet */}
      {panelOpen && (
        <div
          id={panelId}
          ref={panelRef}
          role="dialog"
          aria-labelledby={panelTitleId}
          data-launcher-panel
          tabIndex={-1}
          className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] max-h-[min(70dvh,32rem)] overflow-y-auto rounded-t-md border border-[var(--color-border-static)] bg-[var(--color-surface-floating)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-150 sm:inset-x-auto sm:bottom-[calc(max(1rem,env(safe-area-inset-bottom))+3.5rem)] sm:right-4 sm:w-[380px] sm:max-w-[calc(100vw-2rem)] sm:rounded-sm sm:pb-5"
        >
          <div className="flex items-start justify-between border-b border-[var(--color-border)] pb-3">
            <div>
              <h2 id={panelTitleId} className="text-base font-semibold text-[var(--color-fg-primary)]">信息与反馈</h2>
              <p className="text-xs text-[var(--color-fg-secondary)]">找到最新信息，也可以告诉我们遇到的问题</p>
            </div>
            <button
              type="button"
              ref={closeButtonRef}
              onClick={() => {
                setPanelOpen(false);
                launcherButtonRef.current?.focus();
              }}
              className="rounded-sm p-1 text-[var(--color-fg-secondary)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
              aria-label="关闭面板"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-4 space-y-4 text-sm">
            <section className="space-y-1.5">
              <h3 className="font-medium text-[var(--color-fg-primary)]">最新公告</h3>
              {props.latestAnnouncement ? (
                <>
                  <p className="font-medium text-[var(--color-fg-primary)]">{props.latestAnnouncement.title}</p>
                  <p className="text-xs text-[var(--color-fg-secondary)]">
                    {props.latestAnnouncement.scopeLabel} · {new Date(props.latestAnnouncement.publishedAt).toLocaleDateString("zh-CN")}
                  </p>
                  <Link
                    href={props.season ? `/${props.season.slug}/announcements` : "/announcements"}
                    className="inline-flex text-xs text-[var(--color-accent)] hover:underline"
                    onClick={() => {
                      setPanelOpen(false);
                      markLatestAcknowledged();
                    }}
                  >
                    查看全部公告 →
                  </Link>
                </>
              ) : (
                <p className="text-xs text-[var(--color-fg-secondary)]">暂时没有新的公告。</p>
              )}
            </section>

            <section className="space-y-1.5 border-t border-[var(--color-border)] pt-3">
              <h3 className="font-medium text-[var(--color-fg-primary)]">赛事信息</h3>
              {props.season && props.seasonInfo ? (
                <>
                  {(() => {
                    const groupCount = activeGroupCount(props.seasonInfo);
                    const hasContacts = props.seasonInfo.contacts.length > 0;
                    return (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-fg-secondary)]">
                        <Link href={`/${props.season.slug}/info`} onClick={() => setPanelOpen(false)} className="text-[var(--color-accent)] hover:underline">
                          {props.seasonInfo.rules.label}
                        </Link>
                        {groupCount > 0 && (
                          <>
                            <span>·</span>
                            <Link href={`/${props.season.slug}/info`} onClick={() => setPanelOpen(false)} className="text-[var(--color-accent)] hover:underline">
                              交流群（{groupCount} 个）
                            </Link>
                          </>
                        )}
                        {hasContacts && (
                          <>
                            <span>·</span>
                            <Link href={`/${props.season.slug}/info`} onClick={() => setPanelOpen(false)} className="text-[var(--color-accent)] hover:underline">
                              联系方式
                            </Link>
                          </>
                        )}
                      </div>
                    );
                  })()}
                  <Link href={`/${props.season.slug}/info`} onClick={() => setPanelOpen(false)} className="inline-flex text-xs text-[var(--color-accent)] hover:underline">
                    查看完整赛事信息 →
                  </Link>
                </>
              ) : (
                <Link href="/seasons" onClick={() => setPanelOpen(false)} className="inline-flex text-xs text-[var(--color-accent)] hover:underline">
                  浏览正在进行与历史赛事 →
                </Link>
              )}
            </section>

            <section className="space-y-1.5 border-t border-[var(--color-border)] pt-3">
              <h3 className="font-medium text-[var(--color-fg-primary)]">遇到问题？</h3>
              <p className="text-xs text-[var(--color-fg-secondary)]">向 RivalHub 团队提交功能反馈或体验问题。</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={() => {
                  setPanelOpen(false);
                  setFeedbackOpen(true);
                }}
              >
                提交反馈
              </Button>
            </section>
          </div>
        </div>
      )}

      {/* Feedback Dialog */}
      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <FeedbackDialog pathname={pathname} seasonId={props.season?.id ?? null} />
      </Dialog>

      {/* Attention Announcement Modal */}
      <Dialog open={attentionOpen} onOpenChange={(open) => { if (!open) handleAttentionAcknowledge(attentionAnnouncement); }}>
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
            <Button onClick={() => handleAttentionAcknowledge(attentionAnnouncement)}>知道了，收起提醒</Button>
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
