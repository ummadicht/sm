// Counter UI for the store app — the SWAPUP EXPERIENCE CENTER look (owner, 2026-10-17;
// DESIGN.md "FINAL owner decisions"): One UI-like grey-tint background, white cards
// (radius 26) with no borders, blue pill buttons, black outline pills for the second
// choice, Plus Jakarta Sans headlines and the system font for everything else. No logo
// anywhere — the brand is the text wordmark. Green only ever means "passed / good".
// Big type still: this is read at arm's length on a tablet at a busy counter.
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  useWindowDimensions,
  View,
  ViewStyle,
} from "react-native";
import { P } from "../shared/theme";
import { useHeadlineFace } from "../shared/kit/fonts";
import { Arrow } from "../shared/kit/PillButton";
import { Wordmark } from "../shared/kit/text";
import type { SessionStatus } from "./types";

/**
 * The store app's palette: the old token names (so every screen keeps reading the same
 * words) mapped onto the shared P. `up` is the green of a pass; `fix` is the One UI blue
 * of information and the "now" step. The few names P has no word for are the last block.
 */
export const L = {
  bg: P.bg,
  surface: P.surface,
  surface2: P.surface2,
  border: P.line,
  ink: P.ink,
  text: P.ink,
  muted: P.muted,
  /** Placeholders. */
  faint: P.faint,
  up: P.pass,
  upBg: P.passBg,
  fix: P.primary,
  fixBg: P.tint,
  warn: P.warn,
  warnBg: P.warnBg,
  bad: P.fail,
  badBg: P.failBg,
  /** Fields, banners, small tiles. */
  radius: P.radiusSm,
  /** Cards (One UI). */
  cardRadius: P.radius,
  primary: P.primary,
  primaryPressed: P.primaryPressed,
  brand: P.brand,
  tint: P.tint,
  // Store-only (not in P yet): a field's outline — P.line is too faint for a box you type in at arm's length.
  fieldLine: "#D1D1D6",
} as const;

export const WIDE_AT = 720;

/** Two columns when the screen is at least 720 dp wide (tablets, phones in landscape). */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const wide = width >= WIDE_AT;
  const pad = wide ? 24 : 16;
  const content = Math.min(width, 1240) - pad * 2;
  return { width, height, wide, pad, content };
}

export type Tone = "up" | "fix" | "warn" | "bad" | "muted";
const TONE: Record<Tone, { fg: string; bg: string }> = {
  up: { fg: L.up, bg: L.upBg },
  fix: { fg: L.fix, bg: L.fixBg },
  warn: { fg: L.warn, bg: L.warnBg },
  bad: { fg: L.bad, bg: L.badBg },
  muted: { fg: L.muted, bg: L.surface2 },
};
export const toneColor = (t: Tone) => TONE[t].fg;

/** The headline face (Plus Jakarta Sans once loaded, the system font at the same weight until then). */
export function useHead(weight: "800" | "700" = "800"): TextStyle {
  return useHeadlineFace(weight);
}

type BtnKind = "primary" | "secondary" | "danger" | "ghost";
/**
 * Pills (samsung.com). primary = filled blue; secondary = 1.5 px black outline; danger = red
 * on a pale red pill; ghost = blue text only. A big primary is the screen's main move: label
 * on the left, arrow on the right (as in SwapUp Check). Busy shows a spinner in its place.
 */
export function Btn({
  title,
  onPress,
  kind = "primary",
  disabled,
  busy,
  big,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: BtnKind;
  disabled?: boolean;
  busy?: boolean;
  big?: boolean;
  style?: ViewStyle;
}) {
  const fg = kind === "primary" ? "#fff" : kind === "danger" ? L.bad : kind === "secondary" ? L.ink : L.primary;
  const off = disabled || busy;
  const lead = big && kind === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => [
        s.btn,
        big && s.btnBig,
        lead && s.btnLead,
        kind === "primary" && { backgroundColor: pressed ? L.primaryPressed : L.primary },
        kind === "secondary" && [s.btnOutline, pressed && { backgroundColor: L.surface2 }],
        kind === "danger" && { backgroundColor: L.badBg, opacity: pressed ? 0.8 : 1 },
        kind === "ghost" && { opacity: pressed ? 0.6 : 1 },
        disabled ? { opacity: 0.4 } : null,
        style,
      ]}
    >
      {lead ? (
        <>
          <Text style={[s.btnText, s.btnTextBig, { color: fg, flex: 1, textAlign: "left" }]} numberOfLines={2}>
            {title}
          </Text>
          <View style={s.btnIcon}>{busy ? <ActivityIndicator color={fg} /> : <Arrow color={fg} />}</View>
        </>
      ) : busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[s.btnText, big && s.btnTextBig, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle | ViewStyle[] }) {
  return <View style={[s.card, style as ViewStyle]}>{children}</View>;
}

export function H1({ children, style, numberOfLines }: { children: React.ReactNode; style?: TextStyle; numberOfLines?: number }) {
  const face = useHead("800");
  return (
    <Text accessibilityRole="header" numberOfLines={numberOfLines} style={[s.h1, face, style]}>
      {children}
    </Text>
  );
}
export function H2({ children, style, numberOfLines }: { children: React.ReactNode; style?: TextStyle; numberOfLines?: number }) {
  const face = useHead("700");
  return (
    <Text accessibilityRole="header" numberOfLines={numberOfLines} style={[s.h2, face, style]}>
      {children}
    </Text>
  );
}
export function Body({ children, style, muted }: { children: React.ReactNode; style?: TextStyle | TextStyle[]; muted?: boolean }) {
  return <Text style={[s.body, muted && { color: L.muted }, style as TextStyle]}>{children}</Text>;
}
export function Label({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.label, style]}>{children}</Text>;
}

/** A big figure (money, a grade) in the headline face. */
export function Figure({ children, size = 34, color = L.ink, style }: { children: React.ReactNode; size?: number; color?: string; style?: TextStyle }) {
  const face = useHead("800");
  return <Text style={[{ color, fontSize: size, lineHeight: Math.round(size * 1.2), letterSpacing: size >= 30 ? -0.6 : -0.2, fontVariant: ["tabular-nums"] }, face, style]}>{children}</Text>;
}

export function Chip({ text, tone }: { text: string; tone: Tone }) {
  return (
    <View style={[s.chip, { backgroundColor: TONE[tone].bg }]}>
      <Text style={[s.chipText, { color: TONE[tone].fg }]}>{text}</Text>
    </View>
  );
}

/** A tinted box with a title — errors, warnings, good news. Optional action. */
export function Banner({
  tone,
  title,
  children,
  action,
}: {
  tone: Tone;
  title: string;
  children?: React.ReactNode;
  action?: { title: string; onPress: () => void; busy?: boolean };
}) {
  return (
    <View style={[s.banner, { backgroundColor: TONE[tone].bg }]}>
      <Text style={[s.bannerTitle, { color: TONE[tone].fg }]}>{title}</Text>
      {typeof children === "string" ? <Text style={s.bannerBody}>{children}</Text> : children}
      {action && <Btn title={action.title} onPress={action.onPress} busy={action.busy} kind="secondary" style={{ alignSelf: "flex-start", marginTop: 4 }} />}
    </View>
  );
}

export function Field({ label, hint, error, ...props }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={L.faint}
        {...props}
        style={[s.input, error ? { borderColor: L.bad } : null, props.style]}
      />
      {error ? <Text style={[s.hint, { color: L.bad }]}>{error}</Text> : hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Toggle({ label, value, onValueChange, hint }: { label: string; value: boolean; onValueChange: (v: boolean) => void; hint?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={s.fieldLabel}>{label}</Text>
        {hint ? <Text style={s.hint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: L.primary, false: L.fieldLine }} />
    </View>
  );
}

/** A row of choices (segmented control) — pills; the chosen one is outlined in black. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[s.seg, disabled && { opacity: 0.45 }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled }}
            style={[s.segItem, on && { backgroundColor: L.surface, borderColor: L.ink }]}
          >
            <Text style={[s.segText, on && { color: L.ink }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Screen header: back/close on the left, title, optional actions on the right. Flat on the grey tint. */
export function TopBar({
  title,
  subtitle,
  left,
  right,
}: {
  title: string;
  subtitle?: string;
  left?: { label: string; onPress: () => void };
  right?: React.ReactNode;
}) {
  const face = useHead("700");
  return (
    <View style={s.top}>
      {left ? (
        <Pressable onPress={left.onPress} hitSlop={12} accessibilityRole="button" style={({ pressed }) => [s.topLeft, pressed && { opacity: 0.6 }]}>
          <Text style={s.topLeftText}>{left.label}</Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.topTitle, face]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={s.topSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/** The wordmark (no logo) with the store's name under it, left-aligned — the top of Home and the sign-in screens. */
export function Brand({ store, style }: { store?: string | null; style?: ViewStyle }) {
  return <Wordmark store={store} align="left" style={{ alignItems: "flex-start", marginBottom: 0, ...style }} />;
}

/** Children side by side when wide, stacked otherwise. */
export function Columns({ wide, children, gap = 16 }: { wide: boolean; children: React.ReactNode; gap?: number }) {
  const kids = React.Children.toArray(children).filter(Boolean);
  if (!wide) return <View style={{ gap }}>{kids}</View>;
  return (
    <View style={{ flexDirection: "row", gap, alignItems: "flex-start" }}>
      {kids.map((k, i) => (
        <View key={i} style={{ flex: 1, minWidth: 0, gap }}>
          {k}
        </View>
      ))}
    </View>
  );
}

/**
 * "Show details ›" — the explanations a screen leaves out, closed by default (owner, 2026-10-17:
 * "reduce the words": one headline, one sentence, the rest behind this).
 */
export function Details({ children, title = "Show details" }: { children: React.ReactNode; title?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPress={() => setOpen((x) => !x)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ alignSelf: "flex-start", paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}
      >
        <Text style={{ color: L.primary, fontSize: 15, lineHeight: 20, fontWeight: "600" }}>{open ? "Hide details" : `${title} ›`}</Text>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

export function KV({ label, value, tone }: { label: string; value: React.ReactNode; tone?: Tone }) {
  return (
    <View style={s.kv}>
      <Text style={s.kvLabel}>{label}</Text>
      <Text style={[s.kvValue, tone ? { color: TONE[tone].fg } : null]}>{value}</Text>
    </View>
  );
}

// ── formatting ──────────────────────────────────────────────────────────────

/** ₹1,23,456 — Indian digit grouping, no paise (same rule as the web desk). */
export function inr(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "—";
  const neg = amount < 0;
  const str = Math.abs(Math.round(amount)).toString();
  const out = str.length <= 3 ? str : `${str.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${str.slice(-3)}`;
  return `${neg ? "−" : ""}₹${out}`;
}

function minutesBetween(a: number, b: number) {
  return Math.round((b - a) / 60_000);
}
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const m = minutesBetween(t, now);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
export function until(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const m = minutesBetween(now, t);
  if (m <= 0) return "now";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export const STATUS: Record<SessionStatus, { label: string; tone: Tone }> = {
  waiting: { label: "Waiting for scan", tone: "muted" },
  opened: { label: "Page opened", tone: "fix" },
  joined: { label: "App connected", tone: "fix" },
  testing: { label: "Testing", tone: "fix" },
  complete: { label: "Tests done", tone: "up" },
  applied: { label: "On the case", tone: "up" },
  expired: { label: "Expired", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export const s = StyleSheet.create({
  btn: { minHeight: 52, paddingVertical: 12, paddingHorizontal: 22, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  btnBig: { minHeight: 60, paddingVertical: 14 },
  btnLead: { flexDirection: "row", gap: 12, paddingLeft: 26, paddingRight: 20 },
  btnOutline: { borderWidth: 1.5, borderColor: L.ink, backgroundColor: "transparent" },
  btnIcon: { width: 24, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 17, fontWeight: "700", letterSpacing: 0.1, textAlign: "center" },
  btnTextBig: { fontSize: 19 },
  card: { backgroundColor: L.surface, borderRadius: L.cardRadius, padding: 20, gap: 10 },
  h1: { color: L.ink, fontSize: 30, lineHeight: 36, letterSpacing: -0.5 },
  h2: { color: L.ink, fontSize: 21, lineHeight: 27, letterSpacing: -0.2 },
  body: { color: L.text, fontSize: 17, lineHeight: 24 },
  label: { color: L.muted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  chip: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, alignSelf: "flex-start" },
  chipText: { fontSize: 14, fontWeight: "700" },
  banner: { borderRadius: 20, padding: 16, gap: 6 },
  bannerTitle: { fontSize: 17, fontWeight: "700" },
  bannerBody: { color: L.text, fontSize: 16, lineHeight: 23 },
  fieldLabel: { color: L.ink, fontSize: 15, fontWeight: "600" },
  input: {
    minHeight: 54,
    borderWidth: 1.5,
    borderColor: L.fieldLine,
    borderRadius: L.radius,
    paddingHorizontal: 16,
    fontSize: 19,
    color: L.ink,
    backgroundColor: L.surface,
  },
  hint: { color: L.muted, fontSize: 14, lineHeight: 20 },
  seg: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  segItem: { minHeight: 46, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1.5, borderColor: "transparent", backgroundColor: L.surface2, justifyContent: "center" },
  segText: { fontSize: 16, fontWeight: "700", color: L.muted },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 60,
    backgroundColor: L.bg,
  },
  topLeft: { paddingVertical: 8, paddingRight: 6 },
  topLeftText: { color: L.primary, fontSize: 17, fontWeight: "600" },
  topTitle: { color: L.ink, fontSize: 20, lineHeight: 26 },
  topSub: { color: L.muted, fontSize: 14 },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: 16, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: L.border },
  kvLabel: { color: L.muted, fontSize: 16 },
  kvValue: { color: L.ink, fontSize: 16, fontWeight: "700", textAlign: "right", flexShrink: 1 },
});
