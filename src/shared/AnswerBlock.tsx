// THE ANSWER's lines — the ONE component SwapUp Check (native and browser) and SwapUp Store draw
// them with, so the customer's phone and the advisor's tablet can't drift apart (answer spec §F1;
// addendum R7: "refurb vs upgrade shown clearly").
//
//   Current grade C · screen cracked
//   Market price for grade C ₹25,000
//   ┌ Repair ─────────────────┐ ┌ Swap up ──────────────────────────────┐
//   │ or repair it for ₹34,096 │ │ We pay you ₹26,000                     │
//   │                          │ │ + ₹6,199 bonus if you exchange … · S26 │
//   └──────────────────────────┘ └────────────────────────────────────────┘
//
// One white card. The grade and market lines on top, in the server's order; then the repair and
// the we-pay figures at the SAME weight, side by side, the side the headline recommends in the
// tint with a blue edge (never green: green means "passed"). With only one of them (nothing to
// repair, a trade-in done, the repair chosen) its lines simply follow. Every word and number is
// the server's (./answer.ts); this component owns only "Repair", "Swap up" and TEST_PROGRAMME.
// Staff screens add their extras under the matching line through `slots`; the customer passes none.
import React from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { P } from "./theme";
import { Card, Notice, useHeadlineFace } from "./kit";
import { type AnswerLine, TEST_PROGRAMME, lineOf } from "./answer";

export type AnswerSide = "repair" | "swap";
export type AnswerSlot = "grade" | "market" | "swap" | "repair";

const SIDE_LABEL: Record<AnswerSide, string> = { repair: "Repair", swap: "Swap up" };

export function AnswerBlock({
  answer,
  slots,
  wide = false,
  recommended = null,
  choose,
}: {
  answer: { lines: AnswerLine[]; test: boolean };
  /**
   * Staff extras, drawn under: grade → the grade line; market → the market line; swap → the
   * bonus line (or we-pay); repair → the repair line. A slot whose line is absent still shows,
   * in that line's place (e.g. "Nothing to repair" on the repair side).
   */
  slots?: Partial<Record<AnswerSlot, React.ReactNode>>;
  /** The store's tablet. */
  wide?: boolean;
  /** The side the headline recommends: highlighted. */
  recommended?: AnswerSide | null;
  /** Staff only: each side is a choice (the screen's docked pill acts on it); `can` = the server allows it. */
  choose?: { picked: AnswerSide | null; can: Record<AnswerSide, boolean>; onPick: (s: AnswerSide) => void };
}) {
  const face = useHeadlineFace("800");
  const { lines } = answer;
  const top = lines.filter((l) => l.key === "grade" || l.key === "market");
  const repair = lineOf(lines, "repair");
  const wePay = lineOf(lines, "we_pay");
  const bonus = lineOf(lines, "bonus");
  const hasRepair = !!repair || slots?.repair != null;
  const hasSwap = !!wePay || !!bonus || slots?.swap != null;
  const both = hasRepair && hasSwap;

  const topRows: React.ReactNode[] = [];
  for (const key of ["grade", "market"] as const) {
    const line = top.find((l) => l.key === key) ?? null;
    if (!line && slots?.[key] == null) continue;
    topRows.push(
      <View key={key} style={[st.row, topRows.length > 0 && st.rule]}>
        {line ? <LineText line={line} size={wide ? 19 : 17} /> : null}
        {slots?.[key] ?? null}
      </View>
    );
  }

  const figure = (line: AnswerLine | null) =>
    line ? <LineText line={line} size={both ? (wide ? 30 : 22) : wide ? 36 : 28} lineHeight={both ? (wide ? 36 : 28) : wide ? 42 : 34} face={face} /> : null;
  const sideBody: Record<AnswerSide, React.ReactNode> = {
    repair: (
      <>
        {figure(repair)}
        {slots?.repair ?? null}
      </>
    ),
    swap: (
      <>
        {figure(wePay)}
        {bonus ? <LineText line={bonus} size={both ? 15 : 17} lineHeight={both ? 21 : 24} /> : null}
        {slots?.swap ?? null}
      </>
    ),
  };

  return (
    <View style={{ gap: 12 }}>
      <Card pad={false} style={{ paddingHorizontal: wide ? 24 : 20, paddingVertical: 6 }}>
        {topRows}
        {both ? (
          <View style={[st.sides, { gap: wide ? 14 : 10 }, topRows.length > 0 && st.rule]}>
            {(["repair", "swap"] as const).map((side) => (
              <Side key={side} side={side} wide={wide} recommended={recommended === side} choose={choose}>
                {sideBody[side]}
              </Side>
            ))}
          </View>
        ) : hasRepair || hasSwap ? (
          <View style={[st.row, { gap: 6 }, topRows.length > 0 && st.rule]}>{hasRepair ? sideBody.repair : sideBody.swap}</View>
        ) : null}
      </Card>
      {answer.test ? <Notice tone="warn">{TEST_PROGRAMME}</Notice> : null}
    </View>
  );
}

/** One line as the server wrote it, its note after " · " in muted ink. */
function LineText({ line, size, lineHeight, face }: { line: AnswerLine; size: number; lineHeight?: number; face?: object }) {
  return (
    <Text style={[{ color: P.ink, fontSize: size, lineHeight: lineHeight ?? Math.round(size * 1.4), fontVariant: ["tabular-nums"] }, face ?? { fontWeight: "600" }]}>
      {line.text}
      {line.note ? <Text style={st.note}>{` · ${line.note}`}</Text> : null}
    </Text>
  );
}

/** One of the two sides. Recommended: the tint with a blue edge. Staff: tappable, the chosen one outlined in ink. */
function Side({
  side,
  wide,
  recommended,
  choose,
  children,
}: {
  side: AnswerSide;
  wide: boolean;
  recommended: boolean;
  choose?: { picked: AnswerSide | null; can: Record<AnswerSide, boolean>; onPick: (s: AnswerSide) => void };
  children: React.ReactNode;
}) {
  const selected = choose?.picked === side;
  const disabled = !!choose && !choose.can[side];
  const box = (pressed: boolean): ViewStyle => ({
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    gap: 6,
    padding: wide ? 18 : 14,
    borderRadius: P.radiusSm,
    borderWidth: 2,
    borderColor: selected ? P.ink : recommended ? P.primary : disabled ? P.line : "transparent",
    backgroundColor: disabled ? "transparent" : pressed ? P.surface2 : recommended ? P.tint : P.bg,
  });
  const label = <Text style={[st.sideLabel, recommended && { color: P.primary }]}>{SIDE_LABEL[side]}</Text>;
  if (!choose) {
    return (
      <View style={box(false)}>
        {label}
        {children}
      </View>
    );
  }
  return (
    <Pressable onPress={() => choose.onPick(side)} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected, disabled }} style={({ pressed }) => box(pressed)}>
      {label}
      {children}
    </Pressable>
  );
}

const st = StyleSheet.create({
  row: { paddingVertical: 14, gap: 4 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.line },
  sides: { flexDirection: "row", alignItems: "stretch", paddingVertical: 14 },
  sideLabel: { color: P.muted, fontSize: 13, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  note: { color: P.muted, fontWeight: "400" },
});
