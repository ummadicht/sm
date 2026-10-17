// SwapUp palettes.
//
// P = the SWAPUP EXPERIENCE CENTER look (owner, 2026-10-17): a Samsung One UI-like
// light theme — grey-tint background, white cards and sheets (radius 26), blue
// pill buttons, near-black ink, Plus Jakarta Sans 700/800 for headlines (a free
// look-alike of Samsung Sharp Sans) and the system font for everything else
// (SamsungOne on a Samsung phone). No logo anywhere: the brand is the text
// wordmark BRAND.wordmark in P.brand. Green only ever means "passed".
// Building blocks that use it: ./kit (Screen, Headline, PillButton, Sheet…).
//
// T = SwapUp Check's old token names, now mapped onto P so every Check screen
// (and the browser tests' TestShell) is light. Check-only.
// L = the store app's palette, unchanged until the store app moves to P.

export const P = {
  /** Screen background — One UI's grey tint. */
  bg: "#F4F4F6",
  /** Cards, sheets, fields, the QR card. */
  surface: "#FFFFFF",
  /** Progress tracks, pressed rows. */
  surface2: "#ECECF0",
  /** Hairlines between rows. */
  line: "#E3E3E8",
  ink: "#111111",
  muted: "#6E6E73",
  /** Placeholders, rows not reached yet. */
  faint: "#A1A1A6",
  /** CTA / accent — One UI blue. */
  primary: "#0381FE",
  primaryPressed: "#0067D6",
  onPrimary: "#FFFFFF",
  /** The wordmark colour (Samsung blue). */
  brand: "#1428A0",
  /** The one pale fill of the line illustrations. */
  tint: "#E6F0FF",
  /** Line-illustration strokes. */
  stroke: "#111111",
  pass: "#2E9D5B",
  passBg: "#E8F5EC",
  warn: "#C46A00",
  warnBg: "#FFF3E0",
  fail: "#D93025",
  failBg: "#FDECEA",
  /** Cards and sheets (One UI). */
  radius: 26,
  /** Fields, list rows, small cards. */
  radiusSm: 16,
  /** Side padding of every screen. */
  gutter: 24,
};

/** Headline faces (expo-font names; App.tsx loads them). Body text stays on the system font. */
export const FONT = {
  headline: "PlusJakartaSans_800ExtraBold",
  headlineBold: "PlusJakartaSans_700Bold",
} as const;

/** The programme's name — text only, never a logo. */
export const BRAND = {
  wordmark: "SWAPUP EXPERIENCE CENTER",
} as const;

export const T = {
  bg: P.bg,
  surface: P.surface,
  surface2: P.surface2,
  border: P.line,
  text: P.ink,
  muted: P.muted,
  accent: P.primary,
  accentDeep: P.primaryPressed,
  pass: P.pass,
  warn: P.warn,
  fail: P.fail,
  skip: P.faint,
  radius: P.radiusSm,
};

export const L = {
  bg: "#f5f6f8",
  surface: "#ffffff",
  surface2: "#f0f2f5",
  border: "#e2e6ec",
  ink: "#0f1729",
  text: "#0f1729",
  muted: "#6b7486",
  up: "#0a7d5a",
  upBg: "#e6f5ef",
  fix: "#2f5bd3",
  fixBg: "#ebf0fd",
  warn: "#a05a00",
  warnBg: "#fff4e0",
  bad: "#c23030",
  badBg: "#fdecec",
  radius: 14,
};
