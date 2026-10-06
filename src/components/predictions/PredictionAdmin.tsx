"use client";
import { usePredictionConfirmation } from "./usePredictionConfirmation";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { Panel } from "@/components/rivalhub";
import { administerPredictions } from "@/actions/predictions";
import type { PickEmBoardData } from "@/lib/predictions/data";
import type { PredictionRules } from "@/lib/predictions/types";
const labels = {
  silver: "银币挑战数",
  gold: "金币挑战数",
  diamond: "钻币挑战数",
} satisfies Partial<Record<keyof PredictionRules, string>>;
export function PredictionAdmin({ data }: { data: PickEmBoardData }) {
  const { confirm, confirmation } = usePredictionConfirmation();
  const [rules, setRules] = useState({
    silver: data.rules.silver,
    gold: data.rules.gold,
    diamond: data.rules.diamond,
  });
  const [deadline, setDeadline] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  function submit(args: Record<string, unknown>) {
    start(async () => {
      try {
        const r = await administerPredictions({
          seasonId: data.base.seasonId,
          ...args,
        });
        if (r.success) {
          toast.success("操作完成");
          router.refresh();
        } else toast.error(r.error.message);
      } catch {
        toast.error("请求失败，请刷新检查操作记录后重试");
      }
    });
  }
  function open(args: Record<string, unknown>) {
    const date = new Date(deadline);
    if (!deadline || Number.isNaN(date.getTime())) {
      toast.error("请先填写截止时间");
      return;
    }
    submit({ ...args, deadline: date.toISOString() });
  }
  if (data.defaultContext === "qualification-short-swiss")
    return <p>Pick’Em 在 Main Event 名单和种子确认后开放。</p>;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Pick’Em 管理 · {data.base.name}</h1>
      <Panel label="纪念币规则">
        <HelpTooltip
          label="Pick’Em 开放规则"
          content="槽位和挑战容量由赛事政策决定。纪念币门槛在启用时冻结；只有官方 Main Event 阶段名单生成后才能开放提交窗口。Play-in 不提供 Pick’Em。"
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
            <label key={key} className="text-sm">
              {labels[key]}
              <Input
                type="number"
                disabled={data.enabled || pending}
                value={rules[key]}
                min={0}
                onChange={(e) =>
                  setRules({ ...rules, [key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
        </div>
        {!data.enabled && (
          <Button
            className="mt-4"
            disabled={pending}
            onClick={async () => {
              if (await confirm("确认按这些规则开放？开放后不能修改。"))
                submit({ operation: "enable", rules });
            }}
          >
            启用 Pick’Em
          </Button>
        )}
      </Panel>
      {data.enabled && (
        <>
          <Panel label="开放阶段 Pick’Em">
            <label className="text-sm">
              截止时间（本机时区）
              <Input
                className="my-3 max-w-sm"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </label>
            <HelpTooltip
              label="截止时间规则"
              content="截止取填写时间与官方赛程的更早值，开赛后禁止提交；已关闭窗口不能重新打开。"
            />
            <div className="space-y-3">
              {data.base.stages.map((stage) => {
                const contest = data.contests.find(
                  (c) => c.stageKey === stage.key,
                );
                return (
                  <div
                    key={stage.key}
                    className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-3"
                  >
                    <span>{stage.name}</span>
                    {contest ? (
                      <span className="text-sm">
                        {contest.voidReason
                          ? `已作废：${contest.voidReason}`
                          : contest.locked
                            ? "已锁定"
                            : "已开放"}{" "}
                        · {new Date(contest.deadline).toLocaleString("zh-CN")}
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={
                          pending ||
                          data.paused ||
                          !data.base.runs.some((r) => r.key === stage.key)
                        }
                        onClick={() =>
                          open({ operation: "contest", stageKey: stage.key })
                        }
                      >
                        开放阶段 Pick’Em
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
          <Panel label="暂停与异常处理">
            <label className="text-sm">
              操作理由
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="具体说明原因"
                maxLength={1000}
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={pending || !reason.trim()}
                onClick={() =>
                  submit({ operation: "pause", paused: !data.paused, reason })
                }
              >
                {data.paused ? "恢复提交" : "暂停提交"}
              </Button>
              {data.contests
                .filter((c) => !c.voidReason)
                .map((c) => (
                  <Button
                    key={c.id}
                    variant="destructive"
                    disabled={pending || !reason.trim()}
                    onClick={async () => {
                      if (
                        await confirm(
                          "确认作废本阶段预测？本阶段成绩挑战将失效，已有提交保留并显示作废原因。",
                        )
                      )
                        submit({ operation: "void", contestId: c.id, reason });
                    }}
                  >
                    作废{" "}
                    {data.base.stages.find((s) => s.key === c.stageKey)?.name}
                  </Button>
                ))}
            </div>
            <HelpTooltip
              label="官方赛果更正规则"
              content="官方比分或赛程在比赛管理页更正；Pick’Em 由统一结算任务重新判定。"
            />
          </Panel>
        </>
      )}
      {confirmation}
    </div>
  );
}
