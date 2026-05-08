"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateMatchForm } from "@/components/admin/CreateMatchForm";
import { RecordResultForm } from "@/components/admin/RecordResultForm";
import { cancelMatch } from "@/actions/matches";
import { formatCST } from "@/lib/utils/date";

const STATUS_LABELS: Record<string, string> = {
  scheduled: "未开始",
  in_progress: "进行中",
  finished: "已结束",
  cancelled: "已取消",
};

const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  in_progress: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  finished: "bg-green-500/10 text-green-400 border-green-500/20",
  cancelled: "bg-[var(--text-muted)]/10 text-[var(--text-muted)] border-[var(--border)]",
};

const FORMAT_LABELS: Record<string, string> = {
  bo1: "BO1",
  bo3: "BO3",
  bo5: "BO5",
};

const STAGE_LABELS: Record<string, string> = {
  qualifier: "排位赛",
  playoff: "正赛",
};

export interface MatchRow {
  id: string;
  teamAId: string;
  teamAName: string;
  teamBId: string;
  teamBName: string;
  format: string;
  stage: string;
  status: string;
  scoreA: number | null;
  scoreB: number | null;
  scheduledAt: Date | null;
  completedAt: Date | null;
}

interface TeamOption {
  id: string;
  name: string;
}

interface AdminMatchListProps {
  seasonId: string;
  seasonSlug: string;
  matches: MatchRow[];
  teams: TeamOption[];
}

export function AdminMatchList({ seasonId, seasonSlug, matches, teams }: AdminMatchListProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [recordTarget, setRecordTarget] = useState<MatchRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelPending, startCancelTransition] = useTransition();

  function confirmCancel() {
    if (!cancelTarget) return;
    const id = cancelTarget;
    setCancelTarget(null);
    startCancelTransition(async () => {
      const result = await cancelMatch(id);
      if (!result.success) toast.error(result.error.message);
      else toast.success("比赛已取消");
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">比赛管理</h1>
        <Button onClick={() => setShowCreate(true)}>+ 创建比赛</Button>
      </div>

      {matches.length === 0 ? (
        <div className="text-center py-16 text-[var(--text-secondary)]">
          暂无比赛，点击上方按钮创建第一场。
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-[var(--border)] hover:bg-transparent">
                <TableHead className="text-[var(--text-secondary)]">对阵</TableHead>
                <TableHead className="text-[var(--text-secondary)]">赛制</TableHead>
                <TableHead className="text-[var(--text-secondary)]">赛段</TableHead>
                <TableHead className="text-[var(--text-secondary)]">状态</TableHead>
                <TableHead className="text-[var(--text-secondary)]">比分</TableHead>
                <TableHead className="text-[var(--text-secondary)]">时间</TableHead>
                <TableHead className="text-[var(--text-secondary)] text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matches.map((m) => (
                <TableRow key={m.id} className="border-[var(--border)]">
                  <TableCell>
                    <Link
                      href={`/${seasonSlug}/matches/${m.id}`}
                      className="font-medium text-[var(--text-primary)] hover:text-[var(--season-primary)] transition-colors"
                    >
                      {m.teamAName} vs {m.teamBName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-[var(--text-secondary)]">
                    {FORMAT_LABELS[m.format] ?? m.format}
                  </TableCell>
                  <TableCell className="text-[var(--text-secondary)]">
                    {STAGE_LABELS[m.stage] ?? m.stage}
                  </TableCell>
                  <TableCell>
                    <Badge className={`text-xs ${STATUS_STYLES[m.status] ?? ""}`}>
                      {STATUS_LABELS[m.status] ?? m.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-[var(--text-primary)]">
                    {m.scoreA !== null && m.scoreB !== null
                      ? `${m.scoreA} : ${m.scoreB}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-[var(--text-secondary)] text-sm">
                    {m.completedAt
                      ? formatCST(m.completedAt)
                      : m.scheduledAt
                      ? formatCST(m.scheduledAt)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {(m.status === "scheduled" || m.status === "in_progress") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRecordTarget(m)}
                        >
                          录入结果
                        </Button>
                      )}
                      {m.status === "scheduled" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={cancelPending}
                          onClick={() => setCancelTarget(m.id)}
                          className="text-red-400 border-red-400/20 hover:bg-red-400/10"
                        >
                          取消
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 创建比赛 Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>创建比赛</DialogTitle>
          </DialogHeader>
          <CreateMatchForm
            seasonId={seasonId}
            teams={teams}
            onSuccess={() => setShowCreate(false)}
          />
        </DialogContent>
      </Dialog>

      {/* 取消比赛确认 */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认取消比赛</AlertDialogTitle>
            <AlertDialogDescription>
              取消后无法恢复，该场比赛将标记为「已取消」。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>返回</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmCancel}
              className="bg-red-500 hover:bg-red-600"
            >
              确认取消
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 录入结果 Dialog */}
      <Dialog open={!!recordTarget} onOpenChange={(open) => { if (!open) setRecordTarget(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              录入结果 · {recordTarget?.teamAName} vs {recordTarget?.teamBName}
            </DialogTitle>
          </DialogHeader>
          {recordTarget && (
            <RecordResultForm
              matchId={recordTarget.id}
              format={recordTarget.format}
              teamA={{ id: recordTarget.teamAId, name: recordTarget.teamAName }}
              teamB={{ id: recordTarget.teamBId, name: recordTarget.teamBName }}
              onSuccess={() => setRecordTarget(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
