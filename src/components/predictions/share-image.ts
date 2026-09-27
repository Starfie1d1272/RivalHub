import type { Baseline, Pick, PredictionRules } from "@/lib/predictions/types";
import { SWISS_PICK_GROUPS } from "@/lib/predictions/presentation";
/** Draw the same slot/bracket semantics, never an invented result or submission receipt. */
export async function exportPredictionImage(input: {
  eventName: string;
  stageName: string;
  status: string;
  pick: Pick;
  teams: Baseline["teams"];
  rules: PredictionRules;
  filename: string;
}) {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = "perfect" in input.pick ? 1000 : 960;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器无法导出图片");
  const styles = getComputedStyle(document.documentElement);
  const color = (token: string, fallback: string) =>
    styles.getPropertyValue(token).trim() || fallback;
  const background = color("--color-panel", "#101319");
  const foreground = color("--color-fg", "#e5e7eb");
  const accent = color("--color-accent", "#ff7518");
  const border = color("--color-border", "#333b45");
  const muted = color("--color-fg-mid", "#aab0ba");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 1200, 8);
  ctx.font = "bold 36px sans-serif";
  ctx.fillText(input.eventName, 48, 76, 1100);
  ctx.fillStyle = foreground;
  ctx.font = "26px sans-serif";
  ctx.fillText(`${input.stageName} · Pick’Em`, 48, 124);
  ctx.fillStyle = muted;
  ctx.font = "20px sans-serif";
  ctx.fillText(input.status, 48, 162);
  const ids =
    "perfect" in input.pick
      ? [...input.pick.perfect, ...input.pick.advance, ...input.pick.eliminated]
      : input.pick.bracket;
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const url = input.teams.find((team) => team.teamId === id)?.logoUrl;
      if (!url) return;
      const image = new Image();
      image.crossOrigin = "anonymous";
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2500);
        image.onload = () => {
          clearTimeout(timer);
          images.set(id, image);
          resolve();
        };
        image.onerror = () => {
          clearTimeout(timer);
          resolve();
        };
        image.src = url;
      });
    }),
  );
  function slot(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    if (!ctx) return;
    ctx.strokeStyle = border;
    ctx.strokeRect(x, y, width, height);
    const image = images.get(id);
    const name =
      input.teams.find((team) => team.teamId === id)?.name ?? "待选择";
    if (image) {
      const scale = Math.min(60 / image.naturalWidth, 60 / image.naturalHeight);
      const w = image.naturalWidth * scale,
        h = image.naturalHeight * scale;
      ctx.drawImage(image, x + width / 2 - w / 2, y + 12 + (60 - h) / 2, w, h);
    } else {
      ctx.fillStyle = accent;
      ctx.font = "bold 28px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(id ? name.slice(0, 2) : "＋", x + width / 2, y + 53);
    }
    ctx.textAlign = "center";
    ctx.fillStyle = foreground;
    ctx.font = "18px sans-serif";
    ctx.fillText(name, x + width / 2, y + 94, width - 16);
    ctx.textAlign = "left";
  }
  if ("perfect" in input.pick) {
    for (const [i, group] of SWISS_PICK_GROUPS.entries()) {
      const y = 225 + i * 225;
      ctx.fillStyle = accent;
      ctx.font = "bold 32px sans-serif";
      ctx.fillText(group.record, 48, y);
      ctx.fillStyle = muted;
      ctx.font = "18px sans-serif";
      ctx.fillText(group.label, 320, y);
      for (let n = 0; n < input.rules[group.key]; n++)
        slot(input.pick[group.key][n] ?? "", 48 + n * 184, y + 24, 168, 116);
    }
  } else {
    const positions = [
      [48, 230],
      [48, 395],
      [48, 560],
      [48, 725],
      [460, 312],
      [460, 642],
      [870, 477],
    ];
    ctx.strokeStyle = border;
    ctx.lineWidth = 3;
    for (const [from, to] of [
      [0, 4],
      [1, 4],
      [2, 5],
      [3, 5],
      [4, 6],
      [5, 6],
    ]) {
      const [x, y] = positions[from!]!,
        [dx, dy] = positions[to!]!;
      ctx.beginPath();
      ctx.moveTo(x! + 250, y! + 55);
      ctx.lineTo((x! + 250 + dx!) / 2, y! + 55);
      ctx.lineTo((x! + 250 + dx!) / 2, dy! + 55);
      ctx.lineTo(dx!, dy! + 55);
      ctx.stroke();
    }
    ["八强胜者", "半决赛胜者", "冠军"].forEach((label, i) => {
      ctx.fillStyle = muted;
      ctx.font = "20px sans-serif";
      ctx.fillText(label, [48, 460, 870][i]!, 210);
    });
    positions.forEach(([x, y], i) =>
      slot(
        "bracket" in input.pick ? (input.pick.bracket[i] ?? "") : "",
        x!,
        y!,
        250,
        110,
      ),
    );
  }
  ctx.fillStyle = muted;
  ctx.font = "18px sans-serif";
  ctx.fillText("RIVALHUB · 图片分享不等于正式提交", 48, canvas.height - 34);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) =>
      value ? resolve(value) : reject(new Error("导出失败，请重试")),
    ),
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = input.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
