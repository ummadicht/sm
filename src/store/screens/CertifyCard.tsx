// "Check the phone" — the advisor certifies what the camera couldn't decide, one tap per
// row, by name (../certify.ts reads the server's `certify`; nothing here decides which
// rows are needed). While the card is up the customer's phone shows the test colours by
// itself (the server's `colours` on its status), so the Screen row is tapped while
// looking at white, black, the primaries and the stripes. No forms, no confirm: tapping
// another chip replaces the earlier one, and the server audits every tap. Apply is never
// blocked by it — a row left untapped keeps the SwapUp grade provisional; the AUTOMATIC
// apply waits for it, since applying ends the test colours (swapup lib/domain/autoApply.ts).
//
// It sits INSIDE the camera step of the Session screen (step 3, `inline` — no card of its own),
// only when the camera couldn't decide; the answer opens by itself after the last tap. The
// answer (./Offer.tsx) shows it only when a row is still open there (the results went on first).
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import {
  type CertifyRow,
  type CertifyView,
  ROW_TITLE,
  certifyLead,
  coloursLine,
  pendingRows,
  shownRows,
  stampLine,
  valueTone,
} from "../certify";
import { Body, Card, H2, L, Label, Segmented, toneColor } from "../ui";

/** How long a tap shows as chosen while the server's answer is on its way back to this screen. */
const TAPPED_MS = 6000;

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
  /** Send one tap. Resolves to the server's reason when it refused, else null. */
  onTap: (row: CertifyRow, value: string) => Promise<string | null>;
  /** What goes under the rows (Apply, on the Session screen). */
  children?: React.ReactNode;
}) {
  const rows = shownRows(view);
  const [tapped, setTapped] = useState<Partial<Record<CertifyRow, { value: string; at: number }>>>({});
  const [busy, setBusy] = useState<CertifyRow | null>(null);
  const [err, setErr] = useState<Partial<Record<CertifyRow, string>>>({});
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );

  // A tap shows as chosen until the server's view has it (or a few seconds pass).
  useEffect(() => {
    setTapped((t) => {
      let changed = false;
      const next = { ...t };
      for (const r of Object.keys(t) as CertifyRow[]) {
        if (view.rows[r]?.value === t[r]!.value || Date.now() - t[r]!.at > TAPPED_MS) {
          delete next[r];
          changed = true;
        }
      }
      return changed ? next : t;
    });
  }, [view]);

  async function tap(row: CertifyRow, value: string) {
    const current = tapped[row]?.value ?? view.rows[row]?.value ?? null;
    // The same chip twice does nothing — except the Screen, tapped before the colours showed and showing them now.
    const upgrade = row === "screen" && view.colours === "showing" && view.rows.screen?.withColours === false && !tapped.screen;
    if ((value === current && !upgrade) || busy) return;
    setErr((e) => ({ ...e, [row]: undefined }));
    setTapped((t) => ({ ...t, [row]: { value, at: Date.now() } }));
    setBusy(row);
    const why = await onTap(row, value);
    if (!alive.current) return;
    setBusy(null);
    if (why) {
      setErr((e) => ({ ...e, [row]: why }));
      setTapped((t) => {
        const next = { ...t };
        delete next[row];
        return next;
      });
    }
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
      <Body muted>{certifyLead(view)}</Body>
      {rows.map((row) => {
        const entry = view.rows[row] ?? null;
        const chosen = tapped[row]?.value ?? entry?.value ?? "";
        const stamp = entry && !tapped[row] ? stampLine(entry) : null;
        return (
          <View key={row} style={{ gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: L.border }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <Text style={{ color: L.ink, fontSize: 18, fontWeight: "800" }}>{ROW_TITLE[row]}</Text>
              {busy === row ? (
                <ActivityIndicator color={L.primary} accessibilityLabel="Saving" />
              ) : stamp ? (
                <Text style={{ color: toneColor(valueTone(entry!.value)), fontSize: 15, fontWeight: "700" }}>{stamp}</Text>
              ) : !view.needed.includes(row) ? null : (
                <Text style={{ color: L.muted, fontSize: 15 }}>Not checked yet</Text>
              )}
            </View>
            {view.canEdit ? (
              <Segmented options={view.choices[row]} value={chosen} disabled={row === "screen" && holdScreen} onChange={(value) => void tap(row, value)} />
            ) : (
              <Body>{entry ? entry.label : "Not checked"}</Body>
            )}
            {row === "screen" && colours && view.canEdit ? <Text style={{ color: toneColor(colours.tone), fontSize: 15, lineHeight: 21, fontWeight: "600" }}>{colours.text}</Text> : null}
            {err[row] ? <Text style={{ color: L.bad, fontSize: 15, lineHeight: 21 }}>{err[row]}</Text> : null}
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
