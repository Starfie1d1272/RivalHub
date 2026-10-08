"use client";
import React, {
  useEffect,
  useEffectEvent,
  useRef,
  useMemo,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getPredictionBoard, mutatePrediction } from "@/actions/predictions";
import type { PickEmBoardData } from "@/lib/predictions/data";
import {
  samePick,
  type Choices,
  type Pick,
  type SimMatch,
  type SimulationContext,
} from "@/lib/predictions/types";
import {
  simulateContext,
  replaceContextChoice,
} from "@/lib/predictions/context-simulator";
import { orderedPredictionStages } from "@/lib/predictions/stage-projection";
import { samePredictionEntrants } from "@/lib/predictions/lifecycle";
import { pickEmDockVisible } from "@/lib/predictions/presentation";
import { PickEditor, emptyPick } from "./PickEditor";
import { TournamentBoard } from "./TournamentBoard";
import { PickEmRecord } from "./PickEmRecord";
import { exportPredictionImage } from "./share-image";
import { usePredictionConfirmation } from "./usePredictionConfirmation";
import styles from "@/components/tournament/tournament.module.css";

function defaultStage(context: SimulationContext) {
  const stages = orderedPredictionStages(context.baseline.stages);
  return (
    stages
      .filter((s) => context.baseline.runs.some((r) => r.key === s.key))
      .at(-1)?.key ??
    stages[0]?.key ??
    ""
  );
}

export function PredictionBoard({
  initial,
  slug,
  signedIn,
}: {
  initial: PickEmBoardData;
  slug: string;
  signedIn: boolean;
}) {
  const { confirm, confirmation } = usePredictionConfirmation();
  const [data, setData] = useState(initial);
  const [context, setContext] = useState(
    initial.contexts.find((c) => c.kind === initial.defaultContext)!,
  );
  const [stageKey, setStageKey] = useState(() => defaultStage(context));
  const [choices, setChoices] = useState<Choices>({});
  const [undo, setUndo] = useState<Choices[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Pick>>({});
  const [tab, setTab] = useState<"sim" | "record">("sim");
  const [mobile, setMobile] = useState("sim");
  const [sidebar, setSidebar] = useState(false);
  const [pending, start] = useTransition();
  const readSequence = useRef(0);
  const requests = useRef(new Map<string, string>());
  const base = context.baseline;
  const simulation = useMemo(
    () => simulateContext(context, choices),
    [context, choices],
  );
  const stage = simulation.find((s) => s.key === stageKey);
  const definition = base.stages.find((s) => s.key === stageKey);
  const contest =
    context.kind === "major"
      ? data.contests.find((c) => c.stageKey === stageKey)
      : undefined;
  const dockVisible = pickEmDockVisible(context.kind, contest);
  const pick = contest
    ? contest.locked || contest.voidReason
      ? (contest.submitted?.pick ?? emptyPick(contest.kind))
      : (drafts[contest.id] ?? contest.draft ?? emptyPick(contest.kind))
    : emptyPick(definition?.type ?? "swiss");

  function acceptRefresh(next: PickEmBoardData, reset = false) {
    const switched = data.defaultContext !== next.defaultContext;
    const nextContext =
      next.contexts.find(
        (c) => c.kind === (switched ? next.defaultContext : context.kind),
      ) ?? next.contexts.find((c) => c.kind === next.defaultContext)!;
    setData(next);
    setContext(nextContext);
    if (
      reset ||
      nextContext.kind !== context.kind ||
      nextContext.baseline.revision !== base.revision
    ) {
      setChoices({});
      setUndo([]);
    }
    if (
      nextContext.kind !== context.kind ||
      !nextContext.baseline.stages.some((s) => s.key === stageKey)
    )
      setStageKey(defaultStage(nextContext));
  }
  const acceptAutoRefresh = useEffectEvent(acceptRefresh);
  useEffect(() => {
    let active = true,
      inFlight = false;
    const update = async () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      const sequence = ++readSequence.current;
      try {
        const r = await getPredictionBoard({
          seasonId: initial.base.seasonId,
          view: tab,
        });
        if (active && sequence === readSequence.current && r.success)
          acceptAutoRefresh(r.data);
      } finally {
        inFlight = false;
      }
    };
    const refresh = () => {
      void update().catch(() => {});
    };
    const timer = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    if (tab === "record") refresh();
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [initial.base.seasonId, tab]);

  function run(work: () => Promise<void>) {
    start(async () => {
      try {
        await work();
      } catch {
        toast.error("请求失败，请重试。");
      }
    });
  }
  async function reload(reset = false) {
    const sequence = ++readSequence.current;
    const r = await getPredictionBoard({ seasonId: base.seasonId, view: tab });
    if (sequence !== readSequence.current) return;
    if (r.success) acceptRefresh(r.data, reset);
    else toast.error(r.error.message);
  }
  function choose(match: SimMatch, winner: string) {
    if (choices[`${stageKey}/${match.key}`]?.winner === winner) return;
    setUndo((old) => [...old.slice(-19), choices]);
    setChoices(replaceContextChoice(context, choices, stageKey, match, winner));
  }
  function savePick(submitted: boolean) {
    if (!contest) return;
    run(async () => {
      const payload = { contestId: contest.id, pick, submitted };
      const key = JSON.stringify(payload);
      const requestId = requests.current.get(key) ?? crypto.randomUUID();
      requests.current.set(key, requestId);
      const r = await mutatePrediction({
        operation: "pick",
        seasonId: base.seasonId,
        ...payload,
        requestId,
      });
      if (!r.success) {
        toast.error(r.error.message);
        return;
      }
      requests.current.delete(key);
      toast.success(submitted ? "正式提交成功" : "草稿已保存");
      await reload();
    });
  }
  async function importPick() {
    if (
      !stage?.pick ||
      !contest ||
      !samePredictionEntrants(stage.entrants, contest.entrants) ||
      !(await confirm(
        "用本阶段推演结果替换预测单草稿？正式提交需要再点击“提交预测”。",
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
  }
  function exportImage() {
    if (!contest) return;
    run(async () => {
      const latest = await getPredictionBoard({
        seasonId: base.seasonId,
        view: "sim",
      });
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
    <div className={`${styles.workbench} min-w-0 space-y-4`}>
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-[var(--color-accent)]">
            RIVALHUB / PREDICTION
          </p>
          <h1 className="mt-2 text-2xl font-bold">{base.name} · 赛事推演</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => run(() => reload(true))}
          >
            刷新赛况
          </Button>
          {dockVisible &&
            (!signedIn ? (
              <Link
                href={
                  `/login?next=${encodeURIComponent(`/${slug}/predictions`)}` as never
                }
              >
                登录参与 Pick’Em
              </Link>
            ) : !data.joined ? (
              <Button
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const r = await mutatePrediction({
                      operation: "join",
                      seasonId: base.seasonId,
                    });
                    if (r.success) await reload();
                    else toast.error(r.error.message);
                  })
                }
              >
                加入 Pick’Em
              </Button>
            ) : null)}
        </div>
      </div>
      {context.kind === "major" && (
        <nav aria-label="观赛预测功能" className="flex gap-2">
          <Button
            variant={tab === "sim" ? "default" : "outline"}
            onClick={() => setTab("sim")}
          >
            推演与 Pick’Em
          </Button>
          <Button
            variant={tab === "record" ? "default" : "outline"}
            onClick={() => setTab("record")}
          >
            我的战绩
          </Button>
        </nav>
      )}
      {tab === "record" && context.kind === "major" ? (
        data.view === "record" ? (
          <PickEmRecord data={data} />
        ) : (
          <p role="status">正在加载我的战绩…</p>
        )
      ) : (
        <>
          <div className="flex flex-wrap gap-2" aria-label="赛事阶段">
            {data.contexts
              .filter((c) => c.kind !== context.kind)
              .map((c) => (
                <Button
                  key={c.kind}
                  variant="outline"
                  onClick={() => {
                    setContext(c);
                    setStageKey(defaultStage(c));
                    setChoices({});
                    setUndo([]);
                    setMobile("sim");
                  }}
                >
                  {c.kind === "major" ? "Main Event" : "Play-in"}
                </Button>
              ))}
            {orderedPredictionStages(base.stages).map((s) => (
              <Button
                key={s.key}
                variant={stageKey === s.key ? "default" : "outline"}
                onClick={() => setStageKey(s.key)}
              >
                {s.name}
              </Button>
            ))}
          </div>
          {dockVisible && (
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
          )}
          <div
            className={`grid items-start gap-5 ${dockVisible && sidebar ? "lg:grid-cols-[minmax(0,1fr)_350px]" : ""}`}
          >
            <section
              aria-label="赛事推演"
              className={`min-w-0 space-y-4 ${dockVisible && mobile !== "sim" ? "hidden lg:block" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-fg-mid)]">
                <span>
                  基于官方赛况 ·{" "}
                  {stage && contest && !contest.voidReason && samePredictionEntrants(stage.entrants, contest.entrants) ? "官方名单" : "推演名单"}
                </span>
                <span aria-live="polite">
                  我的选择 {Object.keys(choices).length} 场
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!undo.length}
                  onClick={() => {
                    setChoices(undo.at(-1)!);
                    setUndo(undo.slice(0, -1));
                  }}
                >
                  撤销
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setChoices({});
                    setUndo([]);
                  }}
                >
                  恢复官方赛况
                </Button>
                {dockVisible && (
                  <Button
                    variant="ghost"
                    className="hidden lg:inline-flex"
                    onClick={() => setSidebar(!sidebar)}
                  >
                    {sidebar ? "收起预测单" : "展开预测单"}
                  </Button>
                )}
              </div>
              {stage ? (
                <>
                  <TournamentBoard
                    key={`${context.kind}/${stage.key}`}
                    stage={stage}
                    seasonSlug={slug}
                    teams={base.teams}
                    editable
                    onChoose={choose}
                  />
                  {context.kind === "major" &&
                    stage.complete &&
                    stage.pick &&
                    "bracket" in stage.pick && (
                      <p className="text-sm">
                        预测冠军：
                        {
                          base.teams.find(
                            (t) =>
                              t.teamId ===
                              (stage.pick && "bracket" in stage.pick
                                ? stage.pick.bracket.at(-1)
                                : null),
                          )?.name
                        }
                      </p>
                    )}
                  {dockVisible && stage.pick && (
                    <Button
                      variant="outline"
                      disabled={
                        !contest || !samePredictionEntrants(stage.entrants, contest.entrants) ||
                        contest?.locked ||
                        !!contest?.voidReason ||
                        pending
                      }
                      onClick={importPick}
                    >
                      将本阶段结果填入预测单 →
                    </Button>
                  )}
                </>
              ) : (
                <p className="py-12 text-center text-sm">
                  等待赛事方确认完整赛事种子。
                </p>
              )}
            </section>
            {context.kind === "major" && !contest && (
              <p role="status" className="text-sm text-[var(--color-fg-mid)]">
                Pick’Em 等待本阶段官方名单确认；可以先进行赛事推演。
              </p>
            )}
            {dockVisible && contest && (
              <aside
                className={`min-w-0 ${mobile !== "pick" ? "hidden lg:block" : ""} ${!sidebar ? "lg:hidden" : ""}`}
              >
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
              </aside>
            )}
          </div>
        </>
      )}
      {confirmation}
    </div>
  );
}
