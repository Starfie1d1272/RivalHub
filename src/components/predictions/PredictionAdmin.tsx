"use client";
import { usePredictionConfirmation } from "./usePredictionConfirmation";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/rivalhub";
import { administerPredictions } from "@/actions/predictions";
import type { PredictionBoardData } from "@/lib/predictions/data";
import type { PredictionRules } from "@/lib/predictions/types";
const labels: Record<keyof PredictionRules, string> = {
  perfect: "3–0 槽位",
  advance: "3–1/3–2 槽位",
  eliminated: "0–3 槽位",
  swissTarget: "Swiss 挑战命中门槛",
  silver: "银币挑战数",
  gold: "金币挑战数",
  diamond: "钻币挑战数",
  initialPoints: "首次免费积分",
  stagePoints: "后续阶段补给",
  participationPoints: "有效锁定参与奖励（0为关闭）",
  cutoffMinutes: "单场提前关盘分钟",
};
export function PredictionAdmin({ data }: { data: PredictionBoardData }) {
  const { confirm, confirmation } = usePredictionConfirmation();
  const [rules, setRules] = useState(data.rules);
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
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">观赛预测管理 · {data.base.name}</h1>
      <Panel label="赛事规则">
        <p className="mb-4 text-sm">
          开放后规则冻结。正式阶段名单必须已由 Major
          运行时创建；推演名单不能开放窗口。赛事成绩与纪念币独立于积分，正确预测和币升级不发积分。
        </p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(Object.keys(labels) as (keyof PredictionRules)[]).map((key) => (
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
            冻结规则并开放
          </Button>
        )}
      </Panel>
      {data.enabled && (
        <>
          <Panel label="开放提交与积分窗口">
            <label className="text-sm">
              截止时间（本机时区）
              <Input
                className="my-3 max-w-sm"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </label>
            <p className="mb-4 text-xs">
              服务端会取填写时间与官方赛程的更早值；单场还会扣除提前关盘分钟。已关窗口不可重新打开。
            </p>
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
            <h2 className="mt-6 mb-3 font-semibold">官方单场</h2>
            <div className="space-y-2">
              {data.base.matches.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] py-2 text-sm"
                >
                  <span>
                    {data.base.stages.find((s) => s.key === m.stageKey)?.name} ·{" "}
                    {data.base.teams.find((t) => t.teamId === m.a)?.name} vs{" "}
                    {data.base.teams.find((t) => t.teamId === m.b)?.name}
                  </span>
                  <Button
                    variant="outline"
                    disabled={
                      pending ||
                      data.paused ||
                      m.status !== "scheduled" ||
                      data.markets.some((pool) => pool.matchId === m.id)
                    }
                    onClick={() => open({ operation: "market", matchId: m.id })}
                  >
                    {data.markets.some((pool) => pool.matchId === m.id)
                      ? "积分池已创建"
                      : "开放积分池"}
                  </Button>
                </div>
              ))}
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
                {data.paused ? "恢复新提交与投入" : "暂停新提交与投入"}
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
                          "确认作废本阶段预测？有效提交、成绩挑战和参与奖励将撤销，历史保留。此操作不可撤销。",
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
            <p className="mt-4 text-sm">
              官方比分或赛程请到比赛管理页更正。更正会进入持久重试队列；此页刷新会重新结算。单边池与取消比赛退款，冲正不覆盖原流水。
            </p>
          </Panel>
        </>
      )}
      {confirmation}
    </div>
  );
}
