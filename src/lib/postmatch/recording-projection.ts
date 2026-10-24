import type { MatchRecording } from "./recording-types";
export type RecordingCommand = { kind: "save"; recording: MatchRecording } | { kind: "remove"; id: string } | { kind: "move"; id: string; direction: "up" | "down" };

/** Shared canonical content/order projection; authorization and audit stay in the transaction owner. */
export function projectRecordingCommand(current: readonly MatchRecording[], command: RecordingCommand): MatchRecording[] {
  const recordings = [...current];
  const id = command.kind === "save" ? command.recording.id : command.id;
  const index = recordings.findIndex(row => row.id === id);
  if (command.kind === "save") {
    const recording = { ...command.recording, title: command.recording.title.trim(), url: command.recording.url.trim() };
    if (index >= 0) recordings[index] = recording; else recordings.push(recording);
  } else if (index >= 0) {
    if (command.kind === "remove") recordings.splice(index, 1);
    else {
      const step = command.direction === "up" ? -1 : 1;
      let other = index + step;
      while (other >= 0 && other < recordings.length && recordings[other]!.commentatorUserId !== recordings[index]!.commentatorUserId) other += step;
      if (other >= 0 && other < recordings.length) [recordings[index], recordings[other]] = [recordings[other]!, recordings[index]!];
    }
  }
  return recordings;
}
