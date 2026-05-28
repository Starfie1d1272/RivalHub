import React from "react";
import { Panel } from "@/components/rivalhub";
import type { TeamStyleProfile as TeamStyleProfileData } from "@/actions/team-demo-stats";

interface TeamStyleProfileProps {
  profile: TeamStyleProfileData;
}

const ECONOMY_LABELS: Record<string, string> = {
  full: "全枪全弹",
  semi: "半起",
  eco: "纯ECO",
  force: "强起",
  pistol: "手枪局",
};

function StatCard({
  label,
  value,
  suffix = "",
  color,
}: {
  label: string;
  value: string | number | null;
  suffix?: string;
  color: string;
}) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-center">
      <div className={`text-2xl font-bold ${color}`}>
        {value != null ? `${value}${suffix}` : "—"}
      </div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

export function TeamStyleProfile({ profile }: TeamStyleProfileProps) {
  const topEco = Object.entries(profile.ecoConversion)
    .sort(([, a], [, b]) => b.played - a.played)
    .slice(0, 4);

  return (
    <Panel title={`${profile.teamName} 风格画像`}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="首杀率"
          value={profile.firstKillRate != null ? (profile.firstKillRate * 100).toFixed(1) : null}
          suffix="%"
          color="text-orange-600"
        />
        <StatCard
          label="残局胜率"
          value={profile.clutchWinRate != null ? (profile.clutchWinRate * 100).toFixed(1) : null}
          suffix="%"
          color="text-purple-600"
        />
        <StatCard
          label="总回合数"
          value={profile.totalRounds}
          color="text-blue-600"
        />
      </div>

      {topEco.length > 0 && (
        <>
          <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-3">
            经济转化率
          </h4>
          <div className="space-y-2">
            {topEco.map(([economy, s]) => (
              <div
                key={economy}
                className="flex items-center justify-between text-sm"
              >
                <span className="w-16 font-medium">
                  {ECONOMY_LABELS[economy] ?? economy}
                </span>
                <div className="flex-1 mx-3">
                  <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                    <div
                      className="bg-blue-500 h-2 rounded-full"
                      style={{ width: `${(s.winRate * 100).toFixed(1)}%` }}
                    />
                  </div>
                </div>
                <span className="w-16 text-right font-mono text-xs">
                  {(s.winRate * 100).toFixed(1)}%
                </span>
                <span className="w-12 text-right text-xs text-gray-400">
                  {s.played}局
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
