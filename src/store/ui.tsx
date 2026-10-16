// Light counter UI for the store app (palette L). Big type: this is read at
// arm's length on a tablet at a busy service-centre counter.
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
import { L } from "../shared/theme";
import type { SessionStatus } from "./types";

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

type BtnKind = "primary" | "secondary" | "danger" | "ghost";
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
  const bg = kind === "primary" ? L.up : kind === "danger" ? L.badBg : kind === "secondary" ? L.surface : "transparent";
  const fg = kind === "primary" ? "#fff" : kind === "danger" ? L.bad : kind === "secondary" ? L.ink : L.fix;
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => [
        s.btn,
        big && s.btnBig,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        kind === "secondary" && { borderWidth: 1.5, borderColor: L.border },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, big && s.btnTextBig, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle | ViewStyle[] }) {
  return <View style={[s.card, style as ViewStyle]}>{children}</View>;
}

export function H1({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.h1, style]}>{children}</Text>;
}
export function H2({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.h2, style]}>{children}</Text>;
}
export function Body({ children, style, muted }: { children: React.ReactNode; style?: TextStyle | TextStyle[]; muted?: boolean }) {
  return <Text style={[s.body, muted && { color: L.muted }, style as TextStyle]}>{children}</Text>;
}
export function Label({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.label, style]}>{children}</Text>;
}

export function Chip({ text, tone }: { text: string; tone: Tone }) {
  return (
    <View style={[s.chip, { backgroundColor: TONE[tone].bg }]}>
      <Text style={[s.chipText, { color: TONE[tone].fg }]}>{text}</Text>
    </View>
  );
}

/** A coloured box with a title — errors, warnings, good news. Optional action. */
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
    <View style={[s.banner, { backgroundColor: TONE[tone].bg, borderColor: TONE[tone].fg + "33" }]}>
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
        placeholderTextColor="#9aa2b1"
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
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: L.up, false: L.border }} />
    </View>
  );
}

/** A row of choices (segmented control). */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={s.seg}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[s.segItem, on && { backgroundColor: L.surface, borderColor: L.ink }]}
          >
            <Text style={[s.segText, on && { color: L.ink }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Screen header: back/close on the left, title, optional actions on the right. */
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
  return (
    <View style={s.top}>
      {left ? (
        <Pressable onPress={left.onPress} hitSlop={12} accessibilityRole="button" style={({ pressed }) => [s.topLeft, pressed && { opacity: 0.6 }]}>
          <Text style={s.topLeftText}>{left.label}</Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.topTitle} numberOfLines={1}>
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
  complete: { label: "Done · ready to apply", tone: "up" },
  applied: { label: "Applied to case", tone: "up" },
  expired: { label: "Expired", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export const s = StyleSheet.create({
  btn: { minHeight: 52, paddingVertical: 12, paddingHorizontal: 20, borderRadius: L.radius, alignItems: "center", justifyContent: "center" },
  btnBig: { minHeight: 64, paddingVertical: 16 },
  btnText: { fontSize: 17, fontWeight: "700", letterSpacing: 0.2, textAlign: "center" },
  btnTextBig: { fontSize: 20 },
  card: { backgroundColor: L.surface, borderRadius: L.radius + 2, padding: 18, borderWidth: 1, borderColor: L.border, gap: 10 },
  h1: { color: L.ink, fontSize: 28, fontWeight: "800", letterSpacing: -0.4 },
  h2: { color: L.ink, fontSize: 20, fontWeight: "800", letterSpacing: -0.2 },
  body: { color: L.text, fontSize: 17, lineHeight: 24 },
  label: { color: L.muted, fontSize: 14, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  chip: { paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, alignSelf: "flex-start" },
  chipText: { fontSize: 14, fontWeight: "800" },
  banner: { borderRadius: L.radius, borderWidth: 1, padding: 14, gap: 6 },
  bannerTitle: { fontSize: 17, fontWeight: "800" },
  bannerBody: { color: L.text, fontSize: 16, lineHeight: 23 },
  fieldLabel: { color: L.ink, fontSize: 16, fontWeight: "700" },
  input: {
    minHeight: 54,
    borderWidth: 1.5,
    borderColor: L.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 19,
    color: L.ink,
    backgroundColor: L.surface,
  },
  hint: { color: L.muted, fontSize: 14, lineHeight: 20 },
  seg: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  segItem: { minHeight: 48, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5, borderColor: L.border, backgroundColor: L.surface2, justifyContent: "center" },
  segText: { fontSize: 16, fontWeight: "700", color: L.muted },
  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 60,
    backgroundColor: L.surface,
    borderBottomWidth: 1,
    borderBottomColor: L.border,
  },
  topLeft: { paddingVertical: 8, paddingRight: 6 },
  topLeftText: { color: L.fix, fontSize: 18, fontWeight: "700" },
  topTitle: { color: L.ink, fontSize: 20, fontWeight: "800" },
  topSub: { color: L.muted, fontSize: 14 },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: L.border },
  kvLabel: { color: L.muted, fontSize: 16 },
  kvValue: { color: L.ink, fontSize: 16, fontWeight: "700", textAlign: "right", flexShrink: 1 },
});
