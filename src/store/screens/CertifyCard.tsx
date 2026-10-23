// "Check the phone" — the advisor certifies what the camera couldn't decide, one tap per
// row, by name (../certify.ts reads the server's `certify`; nothing here decides which
// rows are needed). While the card is up the customer's phone shows the test colours by
// itself (the server's `colours` on its status), so the Screen row is tapped while
// looking at white, black, the primaries and the stripes. No forms, no confirm: tapping
// another chip replaces the earlier one, and the server audits every tap. A tap it refuses — one
// better than what the camera found is a 409 with the camera's sentence, nothing recorded (SUP-5) —
// says that sentence under the row, and the row stays as the server holds it. Apply is never
// blocked by it — a row left untapped keeps the SwapUp grade provisional; the AUTOMATIC
// apply waits for it, since applying ends the test colours (swapup lib/domain/autoApply.ts).
//
// It sits INSIDE the camera step of the Session screen (step 3, `inline` — no card of its own),
// only when the camera couldn't decide; the answer opens by itself after the last tap. The
// answer (./Offer.tsx) shows it only when a row is still open there (the results went on first).
// On a full check by eye one button tops it (owner, 2026-10-19: "Skip and get on advisor app
// fast"): ALL_FINE taps Screen OK, Body Like new and Liquid "Can't see" (not looked at), one after
// the other, exactly as the three taps would — so the answer opens straight after. The chips stay
// for anything else.
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import {
  type CardTaps,
  type CertifyRow,
  type CertifyView,
  ALL_FINE,
  NO_TAPS,
  ROW_TITLE,
  allFineTaps,
  certifyLead,
  coloursLine,
  letGo,
  pendingRows,
  rowFace,
  shownRows,
  tapAnswered,
  tapSent,
  tapsSettled,
  valueTone,
} from "../certify";
import { Body, Btn, Card, H2, L, Label, Segmented, toneColor } from "../ui";

export function CheckThePhone({
  view,
  label,
  inline = false,
  holdScreen = false,
  onTap,
  children,
}: {
  view: CertifyView;
  /** The Screen row waits: the customer's phone is still testing and shows the colours after (../flow.ts holdScreen). */
  holdScreen?: boolean;
  /** A small label over the title. */
  label?: string;
  /** Inside another card (the camera step): a ruled section, not a card of its own. */
  inline?: boolean;
  /** Send one tap. Resolves to the server's reason when it refused (its sentence as sent — ../staffClient errText), else null. */
  onTap: (row: CertifyRow, value: string) => Promise<string | null>;
  /** What goes under the rows (Apply, on the Session screen). */
  children?: React.ReactNode;
}) {
  const rows = shownRows(view);
  // The taps on their way and the server's refusals (../certify.ts tapSent / tapAnswered / rowFace).
  const [taps, setTaps] = useState<CardTaps>(NO_TAPS);
  const [busy, setBusy] = useState<CertifyRow | null>(null);
  const [allBusy, setAllBusy] = useState(false);
  const [allErr, setAllErr] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );

  // A tap shows as chosen until the server's view has it (or a few seconds pass).
  useEffect(() => {
    setTaps((s) => tapsSettled(s, view, Date.now()));
  }, [view]);

  async function tap(row: CertifyRow, value: string) {
    const current = taps.tapped[row]?.value ?? view.rows[row]?.value ?? null;
    // The same chip twice does nothing — except the Screen, tapped before the colours showed and showing them now.
    const upgrade = row === "screen" && view.colours === "showing" && view.rows.screen?.withColours === false && !taps.tapped.screen;
    if ((value === current && !upgrade) || busy || allBusy) return;
    setTaps((s) => tapSent(s, row, value, Date.now()));
    setBusy(row);
    const why = await onTap(row, value);
    if (!alive.current) return;
    setBusy(null);
    // Refused (e.g. better than the camera found — a 409, nothing recorded): its sentence under the row, the row untapped.
    setTaps((s) => tapAnswered(s, row, why));
  }

  /** ALL_FINE: its taps in order, stopping at the first the server refuses (its reason under the button). */
  const fine = allFineTaps(view);
  async function allFine() {
    if (busy || allBusy) return;
    setAllErr(null);
    setAllBusy(true);
    for (const t of fine) {
      setTaps((s) => tapSent(s, t.row, t.value, Date.now()));
      const why = await onTap(t.row, t.value);
      if (!alive.current) return;
      if (why) {
        setAllErr(why);
        setTaps((s) => letGo(s, t.row));
        break;
      }
    }
    setAllBusy(false);
  }

  const colours = coloursLine(view);
  const open = pendingRows(view).length > 0;
  const Frame = inline ? InlineFrame : Card;
  return (
    <Frame style={{ gap: 12, ...(open && !inline ? { borderColor: L.fix, borderWidth: 2 } : null) }}>
      <View style={{ gap: 4 }}>
        {label ? <Label style={open ? { color: L.fix } : undefined}>{label}</Label> : null}
        <H2>Check the phone</H2>
      </View>
      {fine.length ? (
        <View style={{ gap: 6 }}>
          {/* It taps the Screen too: it waits with the Screen row while the phone is still testing. */}
          <Btn title={ALL_FINE} busy={allBusy} disabled={holdScreen || !!busy} onPress={() => void allFine()} style={{ alignSelf: "flex-start" }} />
          {allErr ? <Text style={{ color: L.bad, fontSize: 15, lineHeight: 21 }}>{allErr}</Text> : null}
        </View>
      ) : null}
      <Body muted>{certifyLead(view)}</Body>
      {rows.map((row) => {
        const entry = view.rows[row] ?? null;
        const { chosen, stamp, notChecked, error } = rowFace(view, row, taps);
        return (
          <View key={row} style={{ gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: L.border }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <Text style={{ color: L.ink, fontSize: 18, fontWeight: "800" }}>{ROW_TITLE[row]}</Text>
              {busy === row ? (
                <ActivityIndicator color={L.primary} accessibilityLabel="Saving" />
              ) : stamp ? (
                <Text style={{ color: toneColor(valueTone(entry!.value)), fontSize: 15, fontWeight: "700" }}>{stamp}</Text>
              ) : notChecked ? (
                <Text style={{ color: L.muted, fontSize: 15 }}>Not checked yet</Text>
              ) : null}
            </View>
            {view.canEdit ? (
              <Segmented options={view.choices[row]} value={chosen} disabled={row === "screen" && holdScreen} onChange={(value) => void tap(row, value)} />
            ) : (
              <Body>{entry ? entry.label : "Not checked"}</Body>
            )}
            {row === "screen" && colours && view.canEdit ? <Text style={{ color: toneColor(colours.tone), fontSize: 15, lineHeight: 21, fontWeight: "600" }}>{colours.text}</Text> : null}
            {error ? <Text style={{ color: L.bad, fontSize: 15, lineHeight: 21 }}>{error}</Text> : null}
          </View>
        );
      })}
      {children}
    </Frame>
  );
}

/** The card's rows inside the camera step: a rule above, no second card. */
function InlineFrame({ style, children }: { style?: object; children?: React.ReactNode }) {
  return <View style={[{ paddingTop: 14, borderTopWidth: 1, borderTopColor: L.border }, style]}>{children}</View>;
}
