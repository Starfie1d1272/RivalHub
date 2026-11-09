export function hexToRgbString(hex: string): string {
  const cleaned = hex.replace("#", "");
  const bigint = parseInt(cleaned, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `${r}, ${g}, ${b}`;
}

function luminance([r, g, b]: readonly number[]) {
  function linear(channel: number) {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }
  return 0.2126 * linear(r!) + 0.7152 * linear(g!) + 0.0722 * linear(b!);
}

/** Derive interaction colors for the shipped dark surfaces from the saved brand color. */
export function seasonAccentStyle(hex: string): Record<string, string> {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return {};
  const original = hexToRgbString(hex).split(", ").map(Number);
  // This floor leaves room for contrast on the raised surface and for the filled hover tint.
  const minLuminance = 0.26;
  const towardWhite = (step: number) =>
    original.map((channel) => Math.round(channel + ((255 - channel) * step) / 255));
  let low = 0;
  let high = 255;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (luminance(towardWhite(middle)) >= minLuminance) high = middle;
    else low = middle + 1;
  }
  const channels = towardWhite(low);
  const accent =
    low === 0 ? hex : `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  const rgb = channels.join(", ");
  return {
    "--color-accent": accent,
    "--color-accent-soft": `rgba(${rgb}, 0.12)`,
    "--color-accent-edge": `rgba(${rgb}, 0.34)`,
    "--color-accent-fg": "var(--color-bg)",
    "--color-border-focus": accent,
    "--color-border-selected": accent,
  };
}
