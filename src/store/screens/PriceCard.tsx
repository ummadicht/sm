// The STORE MARGIN card — staff only, closed by default at the bottom of the answer
// (./Offer.tsx, "Store margin · staff only"): BUY (the market price — what the store pays; the
// customer also gets the SwapUp premium, which the programme funds)
// against SELL (what it sells for refurbished — PriceIQ's refurbished listing less 2–5%),
// the STORE'S refurb cost between them, and the MARGIN they leave. The store's refurb
// cost is not the customer's refurb quote on the answer — hence its label.
// The numbers and their rules live in ../buySell.ts (tested under node). This card reads
// the case the answer already holds (no fetch of its own) and saves the refurb cost through
// the answer's write queue (a PATCH — it moves no price); the answer repaints it.
import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { type CasePrice, type Figure as Fig, priceCard, refurbHint, refurbInput, refurbPatch, refurbText } from "../buySell";
import { Body, Btn, Card, Figure, H2, L, Label, inr, useLayout } from "../ui";
import type { SaveFn } from "./OfferSheets";

export function PriceCard({ c, save }: { c: CasePrice; save: SaveFn }) {
  const { wide } = useLayout();
  const start = refurbText(c);
  const [text, setText] = useState(start);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A newer case from the server moves the box to its new start — unless the advisor has typed over the old one.
  const lastStart = useRef(start);
  const typed = useRef(text);
  typed.current = text;
  useEffect(() => {
    if (start === lastStart.current) return;
    if (typed.current === lastStart.current) setText(start);
    lastStart.current = start;
  }, [start]);

  async function submit(amount: number) {
    setSaveErr(null);
    setSaving(true);
    const why = await save(refurbPatch(amount));
    if (!alive.current) return;
    setSaving(false);
    if (why) setSaveErr(why);
  }

  const m = priceCard(c, text);
  const savedNow = !m.locked && m.start.saved && m.refurb.amount === m.start.amount;
  const hint = saveErr ? null : refurbHint(c, text);
  const negative = (m.margin.amount ?? 0) < 0;

  return (
    <Card style={{ gap: 16 }}>
      <View style={{ gap: 6 }}>
        <H2 style={{ fontSize: 26, lineHeight: 32 }}>Buy vs sell</H2>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {/* The store's buy cost is the market price; the SwapUp premium on top is the programme's, like the bonus. */}
        <Tile label="Buy" caption="Market price" fig={m.buy} wide={wide} />
        <Tile label="Sell" caption={m.sell.source ?? "After refurb"} fig={m.sell} wide={wide} />
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ color: L.ink, fontSize: 15, fontWeight: "600" }}>Store's refurb cost</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              flex: 1,
              minWidth: 0,
              flexDirection: "row",
              alignItems: "center",
              minHeight: 54,
              paddingHorizontal: 16,
              borderRadius: L.radius,
              borderWidth: 1.5,
              borderColor: saveErr || hint?.bad ? L.bad : L.fieldLine,
              backgroundColor: m.locked ? L.surface2 : L.surface,
            }}
          >
            <Text style={{ color: L.muted, fontSize: 19, fontWeight: "600", marginRight: 6 }}>₹</Text>
            <TextInput
              value={text}
              onChangeText={(t) => {
                setText(refurbInput(t));
                if (saveErr) setSaveErr(null);
              }}
              keyboardType="number-pad"
              inputMode="numeric"
              returnKeyType="done"
              onSubmitEditing={() => {
                if (m.canSave && m.refurb.amount !== null) void submit(m.refurb.amount);
              }}
              editable={!m.locked && !saving}
              placeholder="0"
              placeholderTextColor={L.faint}
              accessibilityLabel="Store's refurb cost in rupees"
              style={{ flex: 1, minWidth: 0, fontSize: 19, color: L.ink, paddingVertical: 12, fontVariant: ["tabular-nums"] }}
            />
          </View>
          {m.locked ? null : (
            <Btn
              title={savedNow ? "Saved" : "Save"}
              kind="secondary"
              onPress={() => {
                if (m.refurb.amount !== null) void submit(m.refurb.amount);
              }}
              busy={saving}
              disabled={!m.canSave}
            />
          )}
        </View>
        {saveErr ? <Text style={{ color: L.bad, fontSize: 14, lineHeight: 20 }}>{`Not saved — ${saveErr}`}</Text> : null}
        {hint ? <Text style={{ color: hint.bad ? L.bad : L.muted, fontSize: 14, lineHeight: 20 }}>{hint.text}</Text> : null}
      </View>

      <View style={{ borderTopWidth: 1, borderTopColor: L.border, paddingTop: 14, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <View style={{ gap: 2, flexShrink: 1 }}>
          <Text style={{ color: L.ink, fontSize: 17, fontWeight: "700" }}>Margin</Text>
          <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>{m.margin.note ?? "Sell − buy − refurb"}</Text>
        </View>
        <Figure size={wide ? 34 : 30} color={negative ? L.bad : m.margin.amount === null ? L.muted : L.ink} style={{ textAlign: "right" }}>
          {inr(m.margin.amount)}
        </Figure>
      </View>
    </Card>
  );
}

/** One side of buy vs sell: the label, the number (or —), and what it means or why it's missing. */
function Tile({ label, caption, fig, wide }: { label: string; caption: string; fig: Fig; wide: boolean }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 140, minWidth: 140, padding: 16, gap: 4, borderRadius: L.radius + 4, backgroundColor: L.bg }}>
      <Label>{label}</Label>
      <Figure size={wide ? 34 : 28} color={fig.amount === null ? L.muted : L.ink}>
        {inr(fig.amount)}
      </Figure>
      <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>{fig.amount === null ? (fig.note ?? caption) : caption}</Text>
      {fig.amount !== null && fig.note ? <Text style={{ color: L.warn, fontSize: 14, lineHeight: 20 }}>{fig.note}</Text> : null}
    </View>
  );
}
