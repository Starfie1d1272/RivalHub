"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/rivalhub";
import type { PredictionBoardData } from "@/lib/predictions/data";
export function PointsBoard({
  data,
  busy,
  onStake,
}: {
  data: PredictionBoardData;
  busy: boolean;
  onStake: (marketId: string, side: string, amount: string) => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [sides, setSides] = useState<Record<string, string>>({});
  const name = (id: string) =>
    data.base.teams.find((t) => t.teamId === id)?.name ?? "队伍";
  const available = BigInt(data.balance) > BigInt(0) ? data.balance : "0";
  return (
    <div className="space-y-5">
      <Panel label="本届免费积分">
        <div className="flex flex-wrap gap-8">
          <div>
            <p className="text-sm">可用积分</p>
            <strong className="text-3xl tabular-nums">{available}</strong>
          </div>
          <div>
            <p className="text-sm">已结算净收益</p>
            <strong className="text-3xl tabular-nums">{data.profit}</strong>
          </div>
          {BigInt(data.balance) < BigInt(0) && (
            <p>
              待抵扣 {(-BigInt(data.balance)).toString()} 积分，后续入账先抵扣。
            </p>
          )}
        </div>
        <p className="mt-4 text-sm text-[var(--color-fg-mid)]">
          积分免费，不可充值、提现、转账或兑换。可追加同一方，投入后不能撤回或换边；零余额等待下一阶段正常补给。
        </p>
      </Panel>
      {!data.markets.length && (
        <p className="py-8 text-center">暂无开放的官方比赛积分池。</p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {data.markets.map((m) => {
          const total = BigInt(m.aPool) + BigInt(m.bPool);
          const mine = BigInt(m.myStake);
          const myPool = BigInt(m.mySide === m.a ? m.aPool : m.bPool);
          const estimate =
            mine > BigInt(0) && myPool > BigInt(0)
              ? (mine + (mine * (total - myPool)) / myPool).toString()
              : null;
          const side = m.mySide ?? sides[m.id] ?? m.a;
          return (
            <Panel
              key={m.id}
              label={
                data.base.stages.find((s) => s.key === m.stageKey)?.name ??
                m.stageKey
              }
            >
              <div className="space-y-3">
                <h3 className="text-base font-semibold">
                  {name(m.a)} vs {name(m.b)}
                </h3>
                <p className="text-xs text-[var(--color-fg-mid)]">
                  截止 {new Date(m.deadline).toLocaleString("zh-CN")} ·{" "}
                  {m.participants} 人参与
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[m.a, m.b].map((id) => (
                    <Button
                      key={id}
                      variant={side === id ? "default" : "outline"}
                      disabled={busy || m.locked || !!m.mySide}
                      className="h-auto min-h-16 whitespace-normal"
                      aria-pressed={side === id}
                      onClick={() => setSides({ ...sides, [m.id]: id })}
                    >
                      <span>
                        {name(id)}
                        <span className="block text-xs">
                          投入 {id === m.a ? m.aPool : m.bPool} ·{" "}
                          {total > BigInt(0)
                            ? (
                                Number(
                                  (BigInt(id === m.a ? m.aPool : m.bPool) *
                                    BigInt(1000)) /
                                    total,
                                ) / 10
                              ).toFixed(1)
                            : "0"}
                          %
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
                <p className="text-xs">投入占比是社区选择，不代表获胜概率。</p>
                {mine > BigInt(0) && (
                  <p className="text-sm">
                    我已投入 {m.myStake} → {name(m.mySide!)}
                    {estimate && m.state === "pending"
                      ? `；当前预计返还 ${estimate}（随池变化）`
                      : ""}
                  </p>
                )}
                {m.state !== "pending" ? (
                  <p role="status">
                    {m.state === "refunded"
                      ? "已退款"
                      : `已按官方结果结算${m.winner ? ` · ${name(m.winner)} 获胜` : ""}`}{" "}
                    · 结算记录 {m.revisions} 版
                  </p>
                ) : m.locked ? (
                  <p>已关盘，等待官方确认本轮结果。</p>
                ) : (
                  <>
                    <label className="block text-sm" htmlFor={`amount-${m.id}`}>
                      投入积分
                    </label>
                    <Input
                      id={`amount-${m.id}`}
                      inputMode="numeric"
                      value={amounts[m.id] ?? ""}
                      placeholder="正整数"
                      onChange={(e) =>
                        setAmounts({ ...amounts, [m.id]: e.target.value })
                      }
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={
                          busy || !data.joined || data.paused || !amounts[m.id]
                        }
                        onClick={() => onStake(m.id, side, amounts[m.id]!)}
                      >
                        确认投入
                      </Button>
                      <Button
                        variant="outline"
                        disabled={
                          busy ||
                          !data.joined ||
                          data.paused ||
                          available === "0"
                        }
                        onClick={() => onStake(m.id, side, "all")}
                      >
                        ALL IN · {available}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </Panel>
          );
        })}
      </div>
      <Panel label="结算规则">
        <p className="text-sm leading-7">
          胜方分配规则：返还本金，再按个人在胜方池中的投入占比分配败方积分，无抽水；整数尾差按稳定顺序分配。取消、对手被替换或单边池退款。弃权按正式胜者结算。官方改判先撤销旧结算再重算；已使用的待追回积分形成待抵扣差额。比赛名单成员与赛事管理员不能参与对应积分池。
        </p>
      </Panel>
    </div>
  );
}
export function PredictionRecord({ data }: { data: PredictionBoardData }) {
  const coin = data.achievement?.coin ?? "未获得";
  const coinTone: Record<string, string> = {
    未获得: "border-slate-600 text-slate-400",
    青铜: "border-amber-700 text-amber-500",
    白银: "border-slate-300 text-slate-200",
    黄金: "border-yellow-400 text-yellow-300",
    钻石: "border-cyan-300 text-cyan-200",
  };
  const labels: Record<string, string> = {
    initial: "首次加入",
    stage: "阶段补给",
    participation: "有效提交奖励",
    stake: "投入",
    settlement: "结算／退款",
    reversal: "改判冲正",
  };
  return (
    <div className="space-y-5">
      <Panel label="观赛成就">
        <div className="flex flex-wrap items-center gap-6">
          <div
            className={`flex h-28 w-28 flex-col items-center justify-center rounded-full border-4 bg-[var(--color-panel-hi)] text-xl font-bold ${coinTone[coin]}`}
            aria-label={`纪念币：${data.achievement?.coin ?? "未获得"}`}
          >
            <span className="text-[10px] tracking-widest">RIVALHUB</span>
            {coin}
            <span className="text-[10px] tracking-widest">PICK’EM</span>
          </div>
          <div>
            <h2 className="text-xl font-semibold">
              {data.achievement?.challenges ?? 0} / 10 项挑战
            </h2>
            <p className="text-sm">
              最高仍可达到：{data.achievement?.maximumCoin ?? "钻石"}
            </p>
            <p className="text-xs text-[var(--color-fg-mid)]">
              首次有效锁定获铜币；银 {data.rules.silver}、金 {data.rules.gold}
              、钻 {data.rules.diamond} 项。成绩更正会重新计算。
            </p>
          </div>
        </div>
        <ul className="mt-5 space-y-2">
          {data.achievement?.progress.map((p) => (
            <li key={p.key} className="text-sm">
              {p.name}：{p.locked ? "✓ 有效完整提交" : "尚无有效锁定"} ·{" "}
              {p.judged
                ? `命中 ${p.hits}，成绩挑战 ${p.challenges} 项`
                : `等待正式判定${data.base.stages.find((s) => s.key === p.key)?.type === "swiss" ? `（至少 ${data.rules.swissTarget} 中）` : ""}`}
            </li>
          ))}
        </ul>
      </Panel>
      <div className="grid gap-5 md:grid-cols-2">
        {[
          { title: "积分榜 · 已结算净收益", rows: data.pointsLeaderboard },
          { title: "Pick’Em 榜 · 命中数", rows: data.pickLeaderboard },
        ].map((board) => (
          <Panel key={board.title} label={board.title}>
            <p className="mb-3 text-xs">
              同分并列，展示前100位。积分榜不计补给、奖励或未结算投入。
            </p>
            <ol className="space-y-2">
              {board.rows.map((row, i) => (
                <li
                  key={i}
                  className={`flex justify-between gap-3 text-sm ${row.isMe ? "font-bold text-[var(--color-accent)]" : ""}`}
                >
                  <span>
                    {row.rank}. {row.name}
                    {row.isMe ? "（我）" : ""}
                  </span>
                  <span>{row.value}</span>
                </li>
              ))}
            </ol>
          </Panel>
        ))}
      </div>
      <Panel label="我的积分流水 · 最近100笔">
        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">时间</th>
                <th>来源</th>
                <th>积分变动</th>
                <th>净收益变动</th>
              </tr>
            </thead>
            <tbody>
              {data.ledger.map((l) => (
                <tr
                  key={l.id}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="p-2 whitespace-nowrap">
                    {new Date(l.createdAt).toLocaleString("zh-CN")}
                  </td>
                  <td className="whitespace-nowrap">
                    {labels[l.kind] ?? l.kind}
                  </td>
                  <td>{l.amount}</td>
                  <td>{l.profit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
