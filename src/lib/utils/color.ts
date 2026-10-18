export function hexToRgbString(hex: string): string {
  const cleaned = hex.replace("#", "");
  const bigint = parseInt(cleaned, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `${r}, ${g}, ${b}`;
}

/** Complete theme family with readable text for light and dark event colors. */
export function seasonAccentStyle(hex: string): Record<string, string> {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return {};
  const channels = hexToRgbString(hex).split(", ").map(Number);
  const linear = channels.map(channel => { const c = channel / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  const luminance = .2126 * linear[0]! + .7152 * linear[1]! + .0722 * linear[2]!;
  return {
    "--color-accent": hex,
    "--color-accent-rgb": hexToRgbString(hex),
    "--color-accent-soft": `rgba(${hexToRgbString(hex)}, 0.12)`,
    "--color-accent-edge": `rgba(${hexToRgbString(hex)}, 0.34)`,
    "--color-accent-fg": luminance > .179 ? "#0a0c10" : "#ffffff",
    "--color-border-focus": hex,
  };
}
