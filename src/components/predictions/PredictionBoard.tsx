"use client";
import { usePredictionConfirmation } from "./usePredictionConfirmation";
import React, { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/rivalhub";
import {
  getPredictionBoard,
  mutatePrediction,
  savePredictionScenario,
} from "@/actions/predictions";
import type { PredictionBoardData } from "@/lib/predictions/data";
import {
  SIMULATION_VERSION,
  samePick,
  type Baseline,
  type Choices,
  type Pick,
  type SimMatch,
  type SimStage,
} from "@/lib/predictions/types";
import { PickEditor, emptyPick } from "./PickEditor";
import { TournamentBoard } from "./TournamentBoard";
import {
  simulateMajor,
  replaceSimulationChoice,
} from "@/lib/predictions/simulator";
import { orderedPredictionStages } from "@/lib/predictions/stage-projection";
import { exportPredictionImage } from "./share-image";
import { PointsBoard, PredictionRecord } from "./PointsBoard";
interface Saved {
  id: string;
  name: string;
  baseline: Baseline;
  choices: Choices;
  projection: SimStage[];
}
export function PredictionBoard({
  initial,
  slug,
  signedIn,
  saved,
}: {
  initial: PredictionBoardData;
  slug: string;
  signedIn: boolean;
  saved: Saved | null;
}) {
  const { confirm, confirmation } = usePredictionConfirmation();
  const [data, setData] = useState(initial);
  const readSequence = useRef(0);
  const requests = useRef(new Map<string, string>());
  function requestId(payload: unknown) {
    const key = JSON.stringify(payload);
    let id = requests.current.get(key);
    if (!id) {
      id = crypto.randomUUID();
      requests.current.set(key, id);
    }
    return id;
  }
  function clearRequest(payload: unknown) {
    requests.current.delete(JSON.stringify(payload));
  }
  const [base, setBase] = useState(saved?.baseline ?? initial.base);
  const [simulation, setSimulation] = useState(
    saved?.projection ?? initial.simulation,
  );
  const [choices, setChoices] = useState<Choices>(saved?.choices ?? {});
  const [scenarioId, setScenarioId] = useState<string | undefined>(saved?.id);
  const [undo, setUndo] = useState<Choices[]>([]);
  const [tab, setTab] = useState<"sim" | "points" | "record">("sim");
  const [stageKey, setStageKey] = useState(
    orderedPredictionStages((saved?.baseline ?? initial.base).stages)[0]?.key ?? "",
  );
  const [mobile, setMobile] = useState("sim");
  const [sidebar, setSidebar] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Pick>>({});
  const [scenarioName, setScenarioName] = useState(saved?.name ?? "我的推演");
  const [pending, start] = useTransition();
  const acceptRefresh = useEffectEvent((next: PredictionBoardData) => {
    setData(next);
    if (!Object.keys(choices).length && !scenarioId) {
      setBase(next.base);
      setSimulation(next.simulation);
    }
  });
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      const sequence = ++readSequence.current;
      try {
        const r = await getPredictionBoard({ seasonId: initial.base.seasonId, view: tab });
        if (active && sequence === readSequence.current && r.success) acceptRefresh(r.data);
      } finally { inFlight = false; }
    };
    const update = () => { void refresh().catch(() => { /* Keep the last successful snapshot on transient failures. */ }); };
    update();
    const timer = setInterval(update, 30000);
    document.addEventListener("visibilitychange", update);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [initial.base.seasonId, tab]);
  const stage = simulation.find((s) => s.key === stageKey);
  const definition = base.stages.find((s) => s.key === stageKey);
  const contest = data.contests.find((c) => c.stageKey === stageKey);
  const pick = contest
    ? contest.locked || contest.voidReason
      ? (contest.submitted?.pick ?? emptyPick(contest.kind))
      : (drafts[contest.id] ?? contest.draft ?? emptyPick(contest.kind))
    : emptyPick(definition?.type ?? "swiss");
  const name = (id: string) =>
    base.teams.find((t) => t.teamId === id)?.name ?? "队伍";
  const compatible = base.version === SIMULATION_VERSION;
  async function reload() {
    const sequence = ++readSequence.current;
    const r = await getPredictionBoard({ seasonId: base.seasonId, view: tab });
    if (sequence !== readSequence.current) return;
    if (r.success) {
      setData(r.data);
      if (!Object.keys(choices).length && !scenarioId) {
        setBase(r.data.base);
        setSimulation(r.data.simulation);
      }
    } else toast.error(r.error.message);
  }
  function run(work: () => Promise<void>) {
    start(async () => {
      try {
        await work();
      } catch {
        toast.error("网络请求失败，当前草稿仍保留；请重试。");
      }
    });
  }
  function applyChoices(next: Choices) {
    setUndo((old) => [...old.slice(-19), choices]);
    setChoices(next);
    setSimulation(simulateMajor(base, next, true));
  }
  function choose(match: SimMatch, winner: string) {
    if (!compatible || choices[`${stageKey}/${match.key}`]?.winner === winner)
      return;
    applyChoices(
      replaceSimulationChoice(base, choices, stageKey, match, winner),
    );
  }
  function resetToLatest() {
    run(async () => {
      const result = await getPredictionBoard({ seasonId: base.seasonId, view: tab });
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      ++readSequence.current;
      setData(result.data);
      setBase(result.data.base);
      setSimulation(result.data.simulation);
      setChoices({});
      setUndo([]);
      setScenarioId(undefined);
    });
  }
  function savePick(submitted: boolean) {
    if (!contest) return;
    run(async () => {
      const r = await mutatePrediction({
        operation: "pick",
        seasonId: base.seasonId,
        contestId: contest.id,
        pick,
        submitted,
        requestId: requestId({ contestId: contest.id, pick, submitted }),
      });
      if (!r.success) {
        toast.error(r.error.message);
        return;
      }
      clearRequest({ contestId: contest.id, pick, submitted });
      toast.success(submitted ? "正式提交成功" : "草稿已保存，原有效提交不变");
      await reload();
    });
  }
  async function importPick() {
    if (!stage?.pick || !contest) return;
    if (
      !(await confirm(
        "用本阶段推演结果替换右侧草稿？正式提交需要再点击“提交预测”。",
      ))
    )
      return;
    const source = stage.pick;
    const next =
      "perfect" in source
        ? {
            perfect: source.perfect.slice(0, data.rules.perfect),
            advance: source.advance.slice(0, data.rules.advance),
            eliminated: source.eliminated.slice(0, data.rules.eliminated),
          }
        : source;
    setDrafts({ ...drafts, [contest.id]: next });
    setMobile("pick");
    setSidebar(true);
    toast.success("已填入草稿，请检查并提交");
  }
  function exportImage() {
    if (!contest) return;
    run(async () => {
      const latest = await getPredictionBoard({ seasonId: base.seasonId, view: tab });
      if (!latest.success) {
        toast.error(latest.error.message);
        return;
      }
      const verified = latest.data.contests.find((c) => c.id === contest.id);
      const same =
        verified?.submitted && samePick(verified.submitted.pick, pick);
      const status = verified?.voidReason
        ? "已作废"
        : same
          ? verified.locked
            ? "已锁定"
            : "已提交"
          : "草稿 · 未提交";
      await exportPredictionImage({
        eventName: base.name,
        stageName: definition?.name ?? "赛事阶段",
        status,
        pick,
        teams: base.teams,
        rules: data.rules,
        filename: `RivalHub-${stageKey}-${same ? "已提交" : "草稿"}.png`,
      });
    });
  }
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-[var(--color-accent)]">
            RIVALHUB / PICK’EM
          </p>
          <h1 className="mt-2 text-2xl font-bold">
            {data.base.name} · 观赛预测
          </h1>

        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => run(reload)}
          >
            刷新赛况
          </Button>
          {!signedIn ? (
            <Link
              href={
                `/login?next=${encodeURIComponent(`/${slug}/predictions`)}` as never
              }
            >
              登录参与
            </Link>
          ) : !data.joined && data.enabled ? (
            <Button
              disabled={pending || data.paused}
              onClick={() =>
                run(async () => {
                  const r = await mutatePrediction({
                    operation: "join",
                    seasonId: base.seasonId,
                  });
                  if (r.success) {
                    toast.success(
                      `已加入，首次免费积分 ${data.rules.initialPoints}`,
                    );
                    await reload();
                  } else toast.error(r.error.message);
                })
              }
            >
              免费加入 · {data.rules.initialPoints} 积分
            </Button>
          ) : null}
        </div>
      </div>
      {(!data.enabled || data.paused) && (
        <p
          role="status"
          className="rounded border border-[var(--color-border)] p-3 text-sm"
        >
          {data.paused
            ? "正式预测暂时暂停。已有提交与积分记录保留。"
            : "正式预测尚未开放，可先查看官方赛况和推演。"}
        </p>
      )}
      <nav aria-label="观赛预测功能" className="flex flex-wrap gap-2">
        {[
          ["sim", "推演与 Pick’Em"],
          ["points", "单场积分"],
          ["record", "我的战绩"],
        ].map(([key, label]) => (
          <Button
            key={key}
            variant={tab === key ? "default" : "outline"}
            aria-pressed={tab === key}
            onClick={() => setTab(key as typeof tab)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {tab === "sim" ? (
        <>
          <div className="flex flex-wrap gap-2" aria-label="赛事阶段">
            {orderedPredictionStages(base.stages).map((s) => (
              <Button
                key={s.key}
                variant={stageKey === s.key ? "default" : "outline"}
                onClick={() => {
                  setStageKey(s.key);
                }}
              >
                {s.name}
              </Button>
            ))}
          </div>
          <div className="flex gap-2 lg:hidden">
            <Button
              variant={mobile === "sim" ? "default" : "outline"}
              onClick={() => setMobile("sim")}
            >
              推演
            </Button>
            <Button
              variant={mobile === "pick" ? "default" : "outline"}
              onClick={() => setMobile("pick")}
            >
              我的预测单
            </Button>
          </div>
          <div
            className={`grid items-start gap-5 ${sidebar ? "lg:grid-cols-[minmax(0,1fr)_350px]" : ""}`}
          >
            <div
              className={`min-w-0 space-y-4 ${mobile !== "sim" ? "hidden lg:block" : ""}`}
            >
              <section aria-label={scenarioId ? `保存的推演 · ${scenarioName}` : "赛事推演"}>
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-fg-mid)]">
                    <span>{scenarioId ? `保存的推演 · ${scenarioName}` : "基于官方赛况"} · {stage?.officialEntrants ? "官方名单" : "推演名单"}</span>
                    <span aria-live="polite">我的选择 {Object.keys(choices).length} 场</span>
                    <time dateTime={base.capturedAt}>{new Date(base.capturedAt).toLocaleTimeString("zh-CN")}</time>
                  </div>
                  {!compatible && (
                    <p role="status">
                      旧版规则快照只能查看。重置后可按最新规则推演。
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={pending || !undo.length || !compatible}
                      onClick={() => {
                        const previous = undo.at(-1)!;
                        setChoices(previous);
                        setSimulation(simulateMajor(base, previous, true));
                        setUndo(undo.slice(0, -1));
                      }}
                    >
                      撤销
                    </Button>
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={async () => {
                        if (
                          await confirm(
                            "恢复最新官方赛况？当前未保存推演将被清空，右侧预测单不变。",
                          )
                        )
                          resetToLatest();
                      }}
                    >
                      重置为最新赛况
                    </Button>
                    <Button
                      variant="ghost"
                      className="hidden lg:inline-flex"
                      onClick={() => setSidebar(!sidebar)}
                    >
                      {sidebar ? "收起预测单" : "展开预测单"}
                    </Button>
                  </div>
                  {!stage ? (
                    <p className="py-12 text-center text-sm">
                      {base.teams.length === 0
                        ? "等待赛事方确认完整赛事种子。"
                        : "请先完成上一阶段推演，或等待本阶段官方名单。"}
                    </p>
                  ) : (
                    <>
                      <TournamentBoard
                        stage={stage}
                        teams={base.teams}
                        editable={compatible}
                        onChoose={choose}
                      />
                      {stage.complete && (
                        <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                          {!stage.standings.length && stage.pick && "bracket" in stage.pick && (
                            <p className="text-sm">预测冠军：{name(stage.pick.bracket.at(-1) ?? "")}</p>
                          )}
                          <Button
                            variant="outline"
                            disabled={
                              !contest ||
                              !stage.officialEntrants ||
                              contest.locked ||
                              !!contest.voidReason ||
                              pending
                            }
                            onClick={importPick}
                          >
                            将本阶段结果填入预测单 →
                          </Button>
                          {!stage.officialEntrants && (
                            <p className="text-xs">
                              当前是推演名单，不能导入本届正式预测单。
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
                    <Input
                      className="w-full sm:w-48"
                      aria-label="推演名称"
                      value={scenarioName}
                      maxLength={80}
                      onChange={(e) => setScenarioName(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      disabled={
                        pending || !signedIn || !data.enabled || !compatible
                      }
                      onClick={() =>
                        run(async () => {
                          const r = await savePredictionScenario({
                            seasonId: base.seasonId,
                            choices,
                            scenarioId,
                            name: scenarioName,
                            expectedRevision: base.revision,
                          });
                          if (r.success) {
                            const url = `${location.origin}/${slug}/predictions?scenario=${r.data.id}`;
                            const copied = await navigator.clipboard
                              ?.writeText(url)
                              .then(() => true)
                              .catch(() => false);
                            toast.success(
                              copied
                                ? "推演已保存，分享链接已复制"
                                : "推演已保存，可点击下方分享快照链接",
                            );
                            setScenarioId(r.data.id);
                          } else toast.error(r.error.message);
                        })
                      }
                    >
                      保存推演并分享
                    </Button>
                    {scenarioId && (
                      <Link
                        className="self-center text-sm underline"
                        href={
                          `/${slug}/predictions?scenario=${scenarioId}` as never
                        }
                      >
                        打开分享快照
                      </Link>
                    )}
                  </div>
                </div>
              </section>
            </div>
            <aside
              className={`min-w-0 ${mobile !== "pick" ? "hidden lg:block" : ""} ${!sidebar ? "lg:hidden" : ""}`}
            >
              {contest ? (
                <PickEditor
                  key={contest.id}
                  data={data}
                  contest={contest}
                  pick={pick}
                  onChange={(next) =>
                    setDrafts({ ...drafts, [contest.id]: next })
                  }
                  onSave={savePick}
                  onExport={exportImage}
                  busy={pending}
                />
              ) : (
                <Panel label="我的阶段预测单">
                  <p className="text-sm">
                    等待官方阶段名单和提交窗口开放。左侧模拟不会自动成为正式提交。
                  </p>
                </Panel>
              )}
            </aside>
          </div>
        </>
      ) : data.view !== tab ? (
        <p role="status" className="py-8">正在加载{tab === "points" ? "单场积分" : "我的战绩"}…</p>
      ) : tab === "points" ? (
        <PointsBoard
          data={data}
          busy={pending}
          onStake={async (marketId, optionId, amount) => {
            if (
              !(await confirm(
                `向 ${data.markets.find((m) => m.id === marketId)?.options.find((o) => o.id === optionId)?.label} 投入${amount === "all" ? "全部可用" : ` ${amount} `}积分？提交后不能撤回或换边。`,
              ))
            )
              return;
            run(async () => {
              const r = await mutatePrediction({
                operation: "stake",
                seasonId: base.seasonId,
                marketId,
                optionId,
                amount,
                requestId: requestId({ marketId, optionId, amount }),
              });
              if (r.success) {
                clearRequest({ marketId, optionId, amount });
                toast.success("投入成功");
                await reload();
              } else toast.error(r.error.message);
            });
          }}
        />
      ) : (
        <PredictionRecord data={data} />
      )}
      {confirmation}
    </div>
  );
}
