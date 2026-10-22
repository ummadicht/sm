// REFURB DECISION · STAFF ONLY — closed, at the bottom of the answer (./Offer.tsx). The server's
// five lines (CaseView.refurbEconomics, read by ../refurbEconomics.ts), printed as sent, in the
// desk's order and words (~/projects/swapup components/counter/RefurbDecision.tsx): the phone's
// value as it is, what repairing it costs the store, its value repaired off the same price list,
// the uplift said as the decision, and what SwapUp pays — the answer's own figures. Each figure
// carries where it came from, or why it is missing. Nothing is worked out here.
// The repair cost is the store's to set: the box on its line saves the case's refurbCost through
// the answer's write queue (a PATCH — it moves no price) and the server's answer repaints the
// lines. Never an offer to the customer.
import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { LABEL, OWN_COST, type RefurbDecision, TITLE, canSaveCost, costInput, costPatch, costText, decisionText, readCost, subLine } from "../refurbEconomics";
import { Btn, Card, Figure, L, inr, useLayout } from "../ui";
import type { SaveFn } from "./OfferSheets";

export function RefurbDecisionPanel({ d, save }: { d: RefurbDecision; save: SaveFn }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 12 }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 4, opacity: pressed ? 0.6 : 1 })}
      >
        <Text style={{ flex: 1, color: L.muted, fontSize: 16, fontWeight: "600" }}>{TITLE}</Text>
        <Text style={{ color: L.muted, fontSize: 22, transform: [{ rotate: open ? "90deg" : "0deg" }] }}>›</Text>
      </Pressable>
      {/* The case this screen holds: every answer from the server repaints it. */}
      {open ? <Lines d={d} save={save} /> : null}
    </View>
  );
}

function Lines({ d, save }: { d: RefurbDecision; save: SaveFn }) {
  const { wide } = useLayout();
  const { preRefurb: pre, repairCost: cost, postRepair: post, uplift, offer } = d.lines;
  const fig = wide ? 24 : 21;
  return (
    <Card style={{ gap: 0, paddingVertical: 4 }}>
      <Row label={LABEL.preRefurb} sub={subLine(pre)} amount={pre.amount} size={fig} />
      {d.editable ? <CostRow d={d} save={save} /> : <Row label={LABEL.repairCost} sub={subLine(cost)} amount={cost.amount} size={fig} />}
      <Row label={LABEL.postRepair} sub={subLine(post)} amount={post.amount} size={fig} />
      {/* The decision says its own figure: the uplift is not printed a second time beside it. */}
      <View style={{ marginVertical: 8, padding: 14, gap: 2, borderRadius: L.radius, backgroundColor: L.bg }}>
        <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>{LABEL.uplift}</Text>
        <Text style={{ color: uplift.verdict === "repair" ? L.fix : L.ink, fontSize: wide ? 19 : 17, lineHeight: wide ? 26 : 23, fontWeight: "700" }}>{decisionText(uplift)}</Text>
        {uplift.why ? <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>{uplift.why}</Text> : null}
      </View>
      <Row label={LABEL.offer} sub={subLine(offer)} amount={offer.amount} size={fig} last />
    </Card>
  );
}

/** One line: the label and the server's line under it on the left, the figure (or —) on the right. */
function Row({ label, sub, amount, size, last }: { label: string; sub: string | null; amount: number | null; size: number; last?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: L.border }}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: L.ink, fontSize: 16, fontWeight: "600" }}>{label}</Text>
        {sub ? <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>{sub}</Text> : null}
      </View>
      <Figure size={size} color={amount === null ? L.muted : L.ink} style={{ textAlign: "right" }}>
        {inr(amount)}
      </Figure>
    </View>
  );
}

/** The repair cost line with the store's own box: prefilled with the line's figure, Save once it differs. */
function CostRow({ d, save }: { d: RefurbDecision; save: SaveFn }) {
  const cost = d.lines.repairCost;
  const start = costText(d.lines);
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

  // A newer case from the server moves the box to its new figure — unless the advisor has typed over the old one.
  const lastStart = useRef(start);
  const typed = useRef(text);
  typed.current = text;
  useEffect(() => {
    if (start === lastStart.current) return;
    if (typed.current === lastStart.current) setText(start);
    lastStart.current = start;
  }, [start]);

  const typedCost = readCost(text);
  const canSave = canSaveCost(d, text) && !saving;
  async function submit() {
    if (!canSave || typedCost.amount === null) return;
    setSaveErr(null);
    setSaving(true);
    const why = await save(costPatch(typedCost.amount));
    if (!alive.current) return;
    setSaving(false);
    if (why) setSaveErr(why);
  }
  const bad = !!saveErr || !!typedCost.problem;

  return (
    <View style={{ gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: L.border }}>
      <View style={{ gap: 2 }}>
        <Text style={{ color: L.ink, fontSize: 16, fontWeight: "600" }}>{LABEL.repairCost}</Text>
        {subLine(cost) ? <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>{subLine(cost)}</Text> : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ color: L.muted, fontSize: 15 }}>{OWN_COST}</Text>
        <View
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: "row",
            alignItems: "center",
            minHeight: 50,
            paddingHorizontal: 14,
            borderRadius: L.radius,
            borderWidth: 1.5,
            borderColor: bad ? L.bad : L.fieldLine,
            backgroundColor: L.surface,
          }}
        >
          <Text style={{ color: L.muted, fontSize: 18, fontWeight: "600", marginRight: 6 }}>₹</Text>
          <TextInput
            value={text}
            onChangeText={(t) => {
              setText(costInput(t));
              if (saveErr) setSaveErr(null);
            }}
            keyboardType="number-pad"
            inputMode="numeric"
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            editable={!saving}
            placeholder="—"
            placeholderTextColor={L.faint}
            accessibilityLabel="The store's own repair cost in rupees"
            style={{ flex: 1, minWidth: 0, fontSize: 18, color: L.ink, paddingVertical: 10, textAlign: "right", fontVariant: ["tabular-nums"] }}
          />
        </View>
        <Btn title="Save" kind="secondary" onPress={() => void submit()} busy={saving} disabled={!canSave} />
      </View>
      {saveErr ? <Text style={{ color: L.bad, fontSize: 14, lineHeight: 20 }}>{`Not saved — ${saveErr}`}</Text> : null}
      {!saveErr && typedCost.problem ? <Text style={{ color: L.bad, fontSize: 14, lineHeight: 20 }}>{typedCost.problem}</Text> : null}
    </View>
  );
}
