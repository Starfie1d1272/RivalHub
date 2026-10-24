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
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { TournamentViewSwitch, type TournamentView } from "@/components/tournament/TournamentFlow";
import { Button } from "@/components/ui/button";
import { mutatePrediction as telemetry_mutatePrediction } from "@/actions/predictions";
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
import { PickEmAchievement } from "./PickEmAchievement";
import { exportPredictionImage as unobservedExportPredictionImage } from "./share-image";
import { usePredictionConfirmation } from "./usePredictionConfirmation";
import styles from "@/components/tournament/tournament.module.css";
import { fetchPredictionBoard as getPredictionBoard } from "@/lib/predictions/http-client";
import { observeAction, observeTask } from "@/lib/telemetry/client";

const exportPredictionImage = observeTask("predictions.exportImage", unobservedExportPredictionImage);
const mutatePrediction = observeAction("predictions.mutatePrediction", telemetry_mutatePrediction);

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
  const tab = "sim" as const;
  const [mobile, setMobile] = useState("sim");
  const [view, setView] = useState<TournamentView>("flow");
  const [savedSimulation, setSavedSimulation] = useState<Record<string, Pick>>({});
  const [sidebar, setSidebar] = useState(false);
  const [pending, start] = useTransition();
  const readAbort=useRef<AbortController|null>(null);
  const readSequence = useRef(0);
  const workInFlight = useRef(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
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
    setRefreshFailed(false);
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
      if (document.hidden || inFlight || workInFlight.current) return;
      inFlight = true;
      const sequence = ++readSequence.current;
      try {
        readAbort.current?.abort();
        const abort=new AbortController();readAbort.current=abort;
        const r = await getPredictionBoard({
          seasonId: initial.base.seasonId,
          view: tab,
        },abort.signal);
        if (active && sequence === readSequence.current) {
          if (r.success) acceptAutoRefresh(r.data);
          else setRefreshFailed(true);
        }
      } catch {
        if (active && sequence === readSequence.current) setRefreshFailed(true);
      } finally {
        inFlight = false;
      }
    };
    const refresh = () => {
      void update();
    };
    const timer = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      readAbort.current?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [initial.base.seasonId, tab]);

  function run(work: () => Promise<void>) {
    if (workInFlight.current) return;
    workInFlight.current = true;
    ++readSequence.current;
    start(async () => {
      try {
        await work();
      } catch {
        setRefreshFailed(true);
        toast.error("暂未取得结果，请先刷新赛况确认。");
      } finally {
        workInFlight.current = false;
      }
    });
  }
  async function reload(reset = false) {
    const sequence = ++readSequence.current;
    readAbort.current?.abort();
    const abort=new AbortController();readAbort.current=abort;
    const r = await getPredictionBoard({ seasonId: base.seasonId, view: tab },abort.signal);
    if (sequence !== readSequence.current) return;
    if (r.success) acceptRefresh(r.data, reset);
    else { setRefreshFailed(true); toast.error(r.error.message); }
  }
  function choose(match: SimMatch, winner: string) {
    if (choices[`${stageKey}/${match.key}`]?.winner === winner) return;
    setUndo((old) => [...old.slice(-19), choices]);
    setChoices(replaceContextChoice(context, choices, stageKey, match, winner));
  }
  function savePick(submitted: boolean, nextPick = pick, fromSimulation = false) {
    if (!contest || !signedIn) return;
    run(async () => {
      const payload = { contestId: contest.id, pick: nextPick, submitted };
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
      if (fromSimulation) {
        setDrafts((old) => ({ ...old, [contest.id]: nextPick }));
        setSavedSimulation((old) => ({ ...old, [contest.id]: nextPick }));
        setMobile("pick");
        setSidebar(true);
      }
      toast.success(submitted ? "正式提交成功" : "草稿已保存");
      void reload().catch(()=>{setRefreshFailed(true);toast.error("预测已提交，读取更新失败，请刷新后查看。");});
    });
  }
  const displayedPick = stage?.resultPick ?? stage?.pick;
  const simulationPick = displayedPick
    ? "perfect" in displayedPick
      ? {
          perfect: displayedPick.perfect.slice(0, data.rules.perfect),
          advance: displayedPick.advance.slice(0, data.rules.advance),
          eliminated: displayedPick.eliminated.slice(0, data.rules.eliminated),
        }
      : displayedPick
    : undefined;
  const savedSource = contest ? savedSimulation[contest.id] : undefined;
  const simulationChanged = !!savedSource && !!simulationPick && !samePick(savedSource, simulationPick);
  const draftChanged = !!savedSource && !samePick(savedSource, pick);
  async function importPick() {
    if (!simulationPick || !contest || !stage || !signedIn || pending || contest.locked || contest.voidReason ||
      !samePredictionEntrants(stage.entrants, contest.entrants)) return;
    const existing = "perfect" in pick ? [...pick.perfect, ...pick.advance, ...pick.eliminated] : pick.bracket;
    if (existing.some(Boolean) && !samePick(pick, simulationPick) && !(await confirm(
      "用本阶段推演结果替换并保存预测单草稿？正式提交保持不变。",
    ))) return;
    savePick(false, simulationPick, true);
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
      <div className={styles.predictionHeader}>
        <div className={styles.predictionTitle}>
          <h1 className="text-[28px] font-semibold">赛事推演</h1>
          <p className="text-sm text-[var(--color-fg-mid)]">{base.name}</p>
        </div>
        <div className={styles.predictionHeaderActions}>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => run(() => reload(true))}
          >
            刷新赛况
          </Button>
          {context.kind === "major" && <PickEmAchievement data={data} signedIn={signedIn} />}
        </div>
      </div>
      {refreshFailed && <p role="status" className="text-sm text-[var(--color-warn)]">赛况更新失败，当前保留上次数据。可点击「刷新赛况」。</p>}
      {
        <>
          <div className={styles.predictionStages} aria-label="赛事阶段">
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
          <div className={styles.workspaceToolbar}>
            <TournamentViewSwitch view={view} setView={setView} />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" disabled={!undo.length || pending} onClick={() => { setChoices(undo.at(-1)!); setUndo(undo.slice(0, -1)); }}>撤销</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setChoices({}); setUndo([]); }}>恢复官方赛况</Button>
              {dockVisible && <>
                <Button size="sm" variant="outline" className={`hidden lg:inline-flex ${styles.dockToggle}`} aria-expanded={sidebar} aria-controls="prediction-dock" onClick={() => setSidebar(!sidebar)}>
                  {sidebar ? "收起预测单" : "展开预测单"}
                </Button>
                {signedIn ? <Button size="sm" disabled={!simulationPick || !contest || !stage || !samePredictionEntrants(stage.entrants, contest.entrants) || contest.locked || !!contest.voidReason || pending} onClick={importPick}>
                  {pending ? "正在保存…" : "保存推演为 Pick’Em"}
                </Button> : <Button size="sm" asChild><Link href={`/login?next=${encodeURIComponent(`/${slug}/predictions`)}` as never}>登录保存 Pick’Em</Link></Button>}
              </>}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-fg-mid)]">
            <span>基于官方赛况 · {stage && contest && !contest.voidReason && samePredictionEntrants(stage.entrants, contest.entrants) ? "官方名单" : "推演名单"} · 我的选择 {Object.keys(choices).length} 场</span>
            <div className={styles.legend}><span>○ 系统补全</span><span>● 官方赛果</span><span>✓ 我的选择</span>
              <HelpTooltip label="如何推演" content="点选队伍推演胜者，修改上游会重算后续。未结束比赛默认高种子获胜，不显示虚构比分。保存推演会将当前显示的赛果（含系统补全）保存为本阶段草稿；正式提交请在预测单中确认。刷新赛况会清空推演选择。" />
            </div>
          </div>
          {dockVisible && <div className="flex gap-2 lg:hidden">
            <Button variant={mobile === "sim" ? "default" : "outline"} onClick={() => setMobile("sim")}>推演</Button>
            <Button variant={mobile === "pick" ? "default" : "outline"} onClick={() => setMobile("pick")}>我的预测单</Button>
          </div>}
          <div
            className={`${styles.workspaceCanvas} grid items-start gap-4 ${dockVisible && sidebar ? "lg:grid-cols-[minmax(0,1fr)_350px]" : ""}`}
          >
            <section
              aria-label="赛事推演"
              className={`min-w-0 space-y-4 ${dockVisible && mobile !== "sim" ? "hidden lg:block" : ""}`}
            >
              {stage ? (
                <>
                  <TournamentBoard
                    key={`${context.kind}/${stage.key}`}
                    stage={stage}
                    view={view}
                    seasonSlug={slug}
                    teams={base.teams}
                    editable={!pending}
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

                </>
              ) : (
                <p className="py-12 text-center text-sm">
                  等待赛事方确认完整赛事种子。
                </p>
              )}
            </section>
            {context.kind === "major" && !contest && (
              <p role="status" className="text-sm text-[var(--color-fg-mid)]">
                {stage
                  ? "Pick’Em 等待本阶段官方名单确认；可以先进行赛事推演。"
                  : "Pick’Em 等待本阶段官方名单确认。"}
              </p>
            )}
            {dockVisible && contest && (
              <aside
                id="prediction-dock"
                aria-label="我的预测单"
                className={`${styles.predictionDock} min-w-0 ${mobile !== "pick" ? "hidden lg:block" : ""} ${!sidebar ? "lg:hidden" : ""}`}
              >
                <PickEditor
                  key={contest.id}
                  data={data}
                  signedIn={signedIn}
                  loginHref={`/login?next=${encodeURIComponent(`/${slug}/predictions`)}`}
                  stageName={definition?.name ?? "当前阶段"}
                  simulationStatus={savedSource ? simulationChanged ? "推演已变化，可保存更新草稿" : draftChanged ? "预测单已手动调整" : contest.submitted && samePick(contest.submitted.pick, pick) ? "当前推演已正式提交" : "已保存当前推演 · 草稿未提交" : undefined}
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
      }
      {confirmation}
    </div>
  );
}
