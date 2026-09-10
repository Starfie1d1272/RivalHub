"use client";
import { usePredictionConfirmation } from "./usePredictionConfirmation";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/rivalhub";
import {
  getPredictionBoard,
  mutatePrediction,
  projectPrediction,
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
import { SimulationMatchCard } from "./SimulationMatchCard";
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
  const [tab, setTab] = useState("sim");
  const [stageKey, setStageKey] = useState(initial.base.stages[0]?.key ?? "");
  const [mobile, setMobile] = useState("sim");
  const [round, setRound] = useState(1);
  const [sidebar, setSidebar] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Pick>>({});
  const [scenarioName, setScenarioName] = useState(saved?.name ?? "我的推演");
  const [pending, start] = useTransition();
  useEffect(() => {
    let active = true;
    const timer = setInterval(() => {
      void getPredictionBoard({ seasonId: initial.base.seasonId }).then((r) => {
        if (active && r.success) {
          setData(r.data);
          if (!Object.keys(choices).length && !scenarioId) {
            setBase(r.data.base);
            setSimulation(r.data.simulation);
          }
        }
      });
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [initial.base.seasonId, choices, scenarioId]);
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
    const r = await getPredictionBoard({ seasonId: base.seasonId });
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
  function project(
    next: Choices,
    edit?: { stageKey: string; matchKey: string; winner: string },
    reset = false,
  ) {
    run(async () => {
      const r = await projectPrediction({
        seasonId: base.seasonId,
        choices: next,
        scenarioId: reset ? undefined : scenarioId,
        edit,
      });
      if (!r.success) {
        toast.error(r.error.message);
        return;
      }
      setUndo((old) => [...old.slice(-19), choices]);
      setChoices(r.data.choices);
      setBase(r.data.base);
      setSimulation(r.data.stages);
      if (reset) setScenarioId(undefined);
    });
  }
  async function choose(match: SimMatch, winner: string) {
    const impact =
      base.stages.find((s) => s.key === stageKey)?.type === "single_elim"
        ? "受影响分支的后续选择"
        : "后续轮次及阶段的选择";
    if (
      match.source === "official" &&
      !(await confirm(
        `这场已有官方结果。改为假设后，将清除${impact}并重算对阵。正式预测单不变。`,
      ))
    )
      return;
    if (
      match.source !== "official" &&
      match.winner &&
      match.winner !== winner &&
      !(await confirm(`修改后会清除${impact}。继续重算？`))
    )
      return;
    project(choices, { stageKey, matchKey: match.key, winner });
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
      const latest = await getPredictionBoard({ seasonId: base.seasonId });
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
      const lines = [
        base.name,
        definition?.name ?? stageKey,
        `状态：${status}`,
        `创建：${new Date().toLocaleString("zh-CN")}`,
        ...("perfect" in pick
          ? [
              `3胜0负：${pick.perfect.map(name).join(" / ")}`,
              `3胜1负/2负：${pick.advance.map(name).join(" / ")}`,
              `0胜3负：${pick.eliminated.map(name).join(" / ")}`,
            ]
          : pick.bracket.map(
              (id, i) =>
                `${i < 4 ? `八强${i + 1}` : i < 6 ? `半决赛${i - 3}` : "冠军"}：${id ? name(id) : "未选择"}`,
            )),
        "RivalHub · 图片分享不等于正式提交",
      ];
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 240 + lines.length * 90;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#0d1724";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#4dd8c4";
      ctx.fillRect(0, 0, canvas.width, 8);
      ctx.font = "32px sans-serif";
      lines.forEach((line, i) => {
        ctx.fillStyle = i === 0 ? "#4dd8c4" : "#f1f5f9";
        ctx.fillText(line, 50, 100 + i * 90, 980);
      });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `RivalHub-${stageKey}-${same ? "已提交" : "草稿"}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    });
  }
  return (
    <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-8">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-[var(--color-accent)]">
            RIVALHUB / PICK’EM
          </p>
          <h1 className="mt-2 text-2xl font-bold">
            {data.base.name} · 观赛预测
          </h1>
          <p className="mt-2 text-sm text-[var(--color-fg-mid)]">
            推演一条晋级路径，提交你的判断。
          </p>
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
            onClick={() => setTab(key!)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {tab === "sim" ? (
        <>
          <div className="flex flex-wrap gap-2" aria-label="赛事阶段">
            {base.stages.map((s) => (
              <Button
                key={s.key}
                variant={stageKey === s.key ? "default" : "outline"}
                onClick={() => {
                  setStageKey(s.key);
                  setRound(1);
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
              <Panel
                label={scenarioId ? `保存的推演 · ${scenarioName}` : "赛事推演"}
              >
                <div className="space-y-4">
                  <p className="text-xs text-[var(--color-fg-mid)]">
                    {scenarioId ? "独立快照" : "基于官方赛况"} ·{" "}
                    {new Date(base.capturedAt).toLocaleString("zh-CN")} ·{" "}
                    {stage?.officialEntrants
                      ? "官方阶段名单"
                      : "推演名单，仅供预览"}
                  </p>
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
                        run(async () => {
                          const r = await projectPrediction({
                            seasonId: base.seasonId,
                            choices: previous,
                            scenarioId,
                          });
                          if (r.success) {
                            setChoices(previous);
                            setSimulation(r.data.stages);
                            setUndo(undo.slice(0, -1));
                          } else toast.error(r.error.message);
                        });
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
                          project({}, undefined, true);
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
                      {base.teams.length !== 32
                        ? "等待赛事方确认完整32队种子。"
                        : "请先完成上一阶段推演，或等待本阶段官方名单。"}
                    </p>
                  ) : (
                    <>
                      <label className="block text-sm lg:hidden">
                        当前轮次
                        <select
                          className="ml-3 rounded border bg-[var(--color-panel)] p-2"
                          value={round}
                          onChange={(e) => setRound(Number(e.target.value))}
                        >
                          {[...new Set(stage.matches.map((m) => m.round))].map(
                            (r) => (
                              <option value={r} key={r}>
                                第 {r} 轮
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <div
                        className="flex gap-4 overflow-x-auto pb-4"
                        aria-label="赛事推演轮次"
                      >
                        {[...new Set(stage.matches.map((m) => m.round))].map(
                          (r) => (
                            <section
                              key={r}
                              className={`w-full shrink-0 space-y-3 lg:w-56 ${round !== r ? "hidden lg:block" : ""}`}
                            >
                              <h2 className="text-sm font-semibold">
                                {definition?.type === "single_elim"
                                  ? ["八强", "半决赛", "决赛"][r - 1]
                                  : `第 ${r} 轮`}
                              </h2>
                              {stage.matches
                                .filter((m) => m.round === r)
                                .map((m) => (
                                  <SimulationMatchCard
                                    key={m.key}
                                    match={m}
                                    stageKey={stageKey}
                                    teams={base.teams}
                                    busy={pending}
                                    editable={compatible}
                                    onChoose={choose}
                                  />
                                ))}
                            </section>
                          ),
                        )}
                      </div>
                      {stage.complete && (
                        <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                          <h3 className="text-sm font-semibold">阶段结果</h3>
                          {stage.standings.length ? (
                            <div className="grid gap-2 text-xs sm:grid-cols-2">
                              {stage.standings.map((t) => (
                                <div key={t.teamId}>
                                  {name(t.teamId)} · {t.wins}胜{t.losses}负 ·{" "}
                                  {t.wins === 3 ? "晋级" : "淘汰"}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p>
                              预测冠军：
                              {stage.pick && "bracket" in stage.pick
                                ? name(stage.pick.bracket[6]!)
                                : "—"}
                            </p>
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
              </Panel>
            </div>
            <aside
              className={`min-w-0 ${mobile !== "pick" ? "hidden lg:block" : ""} ${!sidebar ? "lg:hidden" : ""}`}
            >
              {contest ? (
                <PickEditor
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
      ) : tab === "points" ? (
        <PointsBoard
          data={data}
          busy={pending}
          onStake={async (marketId, side, amount) => {
            if (
              !(await confirm(
                `向 ${name(side)} 投入${amount === "all" ? "全部可用" : ` ${amount} `}积分？提交后不能撤回或换边。`,
              ))
            )
              return;
            run(async () => {
              const r = await mutatePrediction({
                operation: "stake",
                seasonId: base.seasonId,
                marketId,
                side,
                amount,
                requestId: requestId({ marketId, side, amount }),
              });
              if (r.success) {
                clearRequest({ marketId, side, amount });
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
