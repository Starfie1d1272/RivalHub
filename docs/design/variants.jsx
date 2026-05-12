// Three visual variants for the redesign.
// Each defines: tokens (colors, type, edge geometry), and a "Chrome" wrapper
// component that themes the whole app shell. Screens read tokens from VariantContext.

const VariantContext = React.createContext(null);
const useVariant = () => React.useContext(VariantContext);

/* ------- variant tokens ------- */

const variantA_TacticalGrid = (accent) => ({
  id: "A",
  name: "TACTICAL GRID",
  blurb: "HLTV-modernized · single-color · hair-thin grid",
  bg: "#0a0c10",
  panel: "#10131a",
  panelHi: "#161a24",
  panelLow: "#0d1016",
  border: "#1f2530",
  borderHi: "#2c3340",
  text: "#e7ecf3",
  textMid: "#8e96a3",
  textDim: "#525a6a",
  accent,
  accentDim: accent + "33",
  danger: "#ff5470",
  ok: "#4dd47a",
  warn: "#ffc44d",
  rsm: 0,
  rmd: 2,
  rlg: 3,
  bodyFont: "'Geist', 'Noto Sans SC', system-ui, sans-serif",
  displayFont: "'Geist', 'Noto Sans SC', system-ui, sans-serif",
  monoFont: "'JetBrains Mono', ui-monospace, monospace",
  displayTransform: "none",
  displayWeight: 600,
  displayTracking: "-0.01em",
  rowBg: "transparent",
  rowAltBg: "rgba(255,255,255,0.018)",
  chipBg: "rgba(255,255,255,0.04)",
});

const variantB_NeonBrutalism = (accent) => ({
  id: "B",
  name: "NEON BRUTALISM",
  blurb: "Sliced display type · diagonal slashes · electric edges",
  bg: "#06070a",
  panel: "#0b0c11",
  panelHi: "#13151d",
  panelLow: "#08090d",
  border: "#1a1d28",
  borderHi: accent,
  text: "#f4f6fa",
  textMid: "#7c8290",
  textDim: "#3f4554",
  accent,
  accentDim: accent + "26",
  danger: "#ff3360",
  ok: "#3eff8b",
  warn: "#ffd84a",
  rsm: 0,
  rmd: 0,
  rlg: 0,
  bodyFont: "'Geist', 'Noto Sans SC', system-ui, sans-serif",
  displayFont: "'Geist', 'Noto Sans SC', system-ui, sans-serif",
  monoFont: "'JetBrains Mono', ui-monospace, monospace",
  displayTransform: "uppercase",
  displayWeight: 800,
  displayTracking: "-0.02em",
  rowBg: "transparent",
  rowAltBg: "rgba(255,255,255,0.025)",
  chipBg: "rgba(255,255,255,0.05)",
});

const variantC_BroadcastStudio = (accent) => ({
  id: "C",
  name: "BROADCAST STUDIO",
  blurb: "Faceit / ESL chrome · layered glow · telemetry tickers",
  bg: "#070a14",
  panel: "#0e1422",
  panelHi: "#162035",
  panelLow: "#0a0f1a",
  border: "#1d2742",
  borderHi: "#2b3a5e",
  text: "#eaf0ff",
  textMid: "#8c98b8",
  textDim: "#4a5478",
  accent,
  accentDim: accent + "33",
  danger: "#ff4d80",
  ok: "#4cdfb1",
  warn: "#ffce4a",
  rsm: 4,
  rmd: 6,
  rlg: 10,
  bodyFont: "'Geist', 'Noto Sans SC', system-ui, sans-serif",
  displayFont: "'Geist', 'Noto Sans SC', system-ui, sans-serif",
  monoFont: "'JetBrains Mono', ui-monospace, monospace",
  displayTransform: "none",
  displayWeight: 700,
  displayTracking: "-0.015em",
  rowBg: "transparent",
  rowAltBg: "rgba(110,140,200,0.04)",
  chipBg: "rgba(110,140,200,0.08)",
});

const buildVariant = (id, accent) => {
  if (id === "A") return variantA_TacticalGrid(accent);
  if (id === "B") return variantB_NeonBrutalism(accent);
  return variantC_BroadcastStudio(accent);
};

window.buildVariant = buildVariant;
window.VariantContext = VariantContext;
window.useVariant = useVariant;
