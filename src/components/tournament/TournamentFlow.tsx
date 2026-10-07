"use client";
import React, { useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, Columns3, LayoutGrid, List } from "lucide-react";
import styles from "./tournament.module.css";
export type TournamentView = "flow" | "compact" | "list";
/** Layout only: adapters retain ownership of official facts and simulation choices. */
export function TournamentFlow({ rounds, view, setView, renderRound, finalResults, legend, label, resultLabel, initialRound }: {
  rounds: number[]; view: TournamentView; setView: (view: TournamentView) => void;
  renderRound: (round: number) => ReactNode; finalResults: ReactNode; legend?: ReactNode;
  label: string; resultLabel: string; initialRound?: number;
}) {
  const [mobileRound, setMobileRound] = useState<number | "results">(initialRound ?? rounds[0] ?? 1);
  return (
    <div className={styles.board} data-layout={view}>
      <div className={styles.toolbar}>
        <div
          role="group"
          aria-label="赛程展示方式"
          className={styles.viewSwitch}
        >
          {(
            [
              ["flow", "晋级路径", Columns3],
              ["compact", "紧凑对阵", List],
              ["list", "轮次列表", LayoutGrid],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => setView(key)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className={styles.legend}>{legend}</div>
      </div>
      {view === "list" && (
        <nav className={styles.mobileRounds} aria-label="当前展示轮次">
          {rounds.map((round) => (
            <button
              key={round}
              type="button"
              aria-label={`展示第 ${round} 轮`}
              aria-pressed={mobileRound === round}
              onClick={() => setMobileRound(round)}
            >
              R{round}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={mobileRound === "results"}
            onClick={() => setMobileRound("results")}
          >
            结果
          </button>
        </nav>
      )}
      <div
        className={styles.viewport}
        tabIndex={0}
        role="region"
        aria-label={label}
      >
        <div
          className={styles.rounds}
          style={{ "--round-count": rounds.length + 1 } as React.CSSProperties}
        >
          {rounds.map((round) => (
            <section
              key={round}
              className={styles.round}
              data-mobile-active={mobileRound === round}
            >
              <h3 className={styles.roundTitle}>
                {view === "list" && <ArrowDown size={18} />}
                <span>ROUND {round}</span>
                {view === "list" && <ArrowDown size={18} />}
              </h3>
              <div className={styles.roundContent}>{renderRound(round)}</div>
              {view !== "list" && (
                <ArrowRight
                  className={styles.roundArrow}
                  size={22}
                  aria-hidden
                />
              )}
            </section>
          ))}
          <section
            className={styles.round}
            aria-label="最终结果"
            data-mobile-active={mobileRound === "results"}
          >
            <h3 className={`${styles.roundTitle} ${styles.finalTitle}`}>
              FINAL RESULTS{" "}
              <span className="sr-only">
                {resultLabel}
              </span>
            </h3>
            <div className={styles.roundContent}>
              {finalResults}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
