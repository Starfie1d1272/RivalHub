/** Only deployed Next chunk basename and numeric coordinates contribute. No text/URL leaves this function. */
export function clientErrorFingerprint(error: unknown, location?: { filename: string; line: number; column: number }): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const ownStack = Object.getOwnPropertyDescriptor(error, "stack")?.value;
  const stack = typeof ownStack === "string" ? ownStack : location && Number.isSafeInteger(location.line) && Number.isSafeInteger(location.column) ? `${location.filename}:${location.line}:${location.column}` : undefined;
  if (typeof stack !== "string") return undefined;
  const frames = [...stack.slice(0, 8192).matchAll(/\/_next\/static\/chunks\/([A-Za-z0-9_.-]{1,100}\.js):(\d{1,7}):(\d{1,7})(?=[)\s]|$)/g)].slice(0, 5);
  if (!frames.length) return undefined;
  const canonical = frames.map(frame => `${frame[1]}:${Number(frame[2])}:${Number(frame[3])}`).join("|");
  let hash = BigInt("0xcbf29ce484222325");
  for (let index = 0; index < canonical.length; index++) hash = BigInt.asUintN(64, (hash ^ BigInt(canonical.charCodeAt(index))) * BigInt("0x100000001b3"));
  return `s1:${hash.toString(16).padStart(16, "0")}`;
}
