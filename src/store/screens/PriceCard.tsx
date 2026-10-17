// The STORE MARGIN card — staff only, closed by default at the bottom of the answer
// (./Offer.tsx, "Store margin · staff only"): BUY (what the store pays the customer)
// against SELL (what it sells for refurbished — PriceIQ's Cashify listing less 2–5%),
// the STORE'S refurb cost between them, and the MARGIN they leave. The store's refurb
// cost is not the customer's refurb quote on the answer — hence its label.
// The numbers and their rules live in ../buySell.ts (tested under node); this file only
// loads the case (GET /api/cases/<id>, again quietly when the app comes back to the front
// and every 30 s), saves the refurb cost (PATCH — it moves no price) and draws it.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Text, TextInput, View } from "react-native";
import { type CasePrice, type Figure as Fig, priceCard, readCasePrice, refurbHint, refurbInput, refurbPatch, refurbText } from "../buySell";
import { StaffClient, errText } from "../staffClient";
import { Banner, Body, Btn, Card, Figure, H2, L, Label, inr, useLayout } from "../ui";

type Load = { state: "loading" } | { state: "error"; text: string } | { state: "ready"; c: CasePrice };

export function PriceCard({ api, caseId }: { api: StaffClient; caseId: string }) {
  const { wide } = useLayout();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // What the box started from on the last load: a quiet refresh only replaces the box when the
  // advisor hasn't typed over it.
  const startText = useRef<string | null>(null);
  const typedRef = useRef("");
  typedRef.current = text;

  /** A case from the server: show it, and start the refurb box from it (unless it holds the advisor's own typing). */
  const take = useCallback((r: unknown, keepTyping = false) => {
    const c = readCasePrice(r);
    if (!c) throw new Error("The server's answer about this case didn't make sense.");
    const next = refurbText(c);
    const dirty = keepTyping && startText.current !== null && typedRef.current !== startText.current;
    startText.current = next;
    setLoad({ state: "ready", c });
    if (!dirty) setText(next);
  }, []);

  const fetchCase = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoad({ state: "loading" });
      try {
        const r = await api.get<unknown>(`/api/cases/${encodeURIComponent(caseId)}`);
        if (alive.current) take(r, quiet);
      } catch (e) {
        // A quiet refresh that fails keeps the card as it was; the next one tries again.
        if (alive.current && !quiet) setLoad({ state: "error", text: errText(e) });
      }
    },
    [api, caseId, take]
  );

  useEffect(() => {
    void fetchCase();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void fetchCase(true);
    });
    const t = setInterval(() => {
      if (AppState.currentState === "active") void fetchCase(true);
    }, 30_000);
    return () => {
      sub.remove();
      clearInterval(t);
    };
  }, [fetchCase]);

  async function save(amount: number) {
    setSaveErr(null);
    setSaving(true);
    try {
      const r = await api.patch<unknown>(`/api/cases/${encodeURIComponent(caseId)}`, refurbPatch(amount));
      if (alive.current) take(r);
    } catch (e) {
      if (alive.current) setSaveErr(errText(e));
    } finally {
      if (alive.current) setSaving(false);
    }
  }

  if (load.state !== "ready") {
    return (
      <Card>
        <Label>Store margin</Label>
        {load.state === "error" ? (
          <Banner tone="bad" title="Couldn't load the price" action={{ title: "Try again", onPress: () => void fetchCase(false) }}>
            {load.text}
          </Banner>
        ) : (
          <Body muted>Loading the price…</Body>
        )}
      </Card>
    );
  }

  const m = priceCard(load.c, text);
  const savedNow = !m.locked && m.start.saved && m.refurb.amount === m.start.amount;
  const hint = saveErr ? null : refurbHint(load.c, text);
  const negative = (m.margin.amount ?? 0) < 0;

  return (
    <Card style={{ gap: 16 }}>
      <View style={{ gap: 6 }}>
        <Label>Store margin</Label>
        <H2 style={{ fontSize: 26, lineHeight: 32 }}>Buy vs sell</H2>
        <Body muted>What you pay the customer, against what the phone sells for once it is refurbished.</Body>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Tile label="Buy" caption="Pay the customer" fig={m.buy} wide={wide} />
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
                if (m.canSave && m.refurb.amount !== null) void save(m.refurb.amount);
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
                if (m.refurb.amount !== null) void save(m.refurb.amount);
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
