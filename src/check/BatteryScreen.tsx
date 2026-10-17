// Battery health — after Scan, before the phone's own tests (swapup
// docs/PHONE-LED-FLOW.md §4, after GradeIQ v2's battery step). The customer opens
// their phone's battery-health page, takes a screenshot and chooses it here; the
// store's server has GradeIQ read the % off it (POST /api/device/battery) and
// records it — below 80 % it counts against the price as battery drain, so the
// screen only ever shows what was read, never what it means for the offer.
// Optional: Skip is always there. Native and browser (the browser's picker is a
// file input — ./batteryShot.web.ts).
import React, { useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { T } from "../shared/theme";
import { Big, Say, openAndroidSettings } from "../diagnostics/parts";
import { Kicker, Note, Screen, Title } from "./screens";
import { batteryGuide, readBatteryAnswer } from "./battery";
import { chooseScreenshot } from "./batteryShot";
import { onIphone } from "./onIphone";
import type { BatteryRec, CheckState } from "./core";
import type { CheckEngine } from "./engine";

/** The latest answer from the store: a %, or "couldn't read it". */
type Last = { healthPct: number } | { healthPct: null };

export function BatteryScreen({ engine, state, onDone }: { engine: CheckEngine; state: CheckState; onDone: (rec: Omit<BatteryRec, "at">) => void }) {
  const guide = useMemo(
    () => batteryGuide({ brand: state.reported?.brand, label: state.session.identity?.label, modelCode: state.reported?.modelCode, ios: onIphone() }),
    [state.reported, state.session.identity]
  );
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** This store's system has no reader for the screenshot (an older server). */
  const [unavailable, setUnavailable] = useState(false);
  const read = last?.healthPct != null ? last.healthPct : null;

  const choose = async () => {
    setNote(null);
    const shot = await chooseScreenshot();
    if (shot.kind === "canceled") return;
    if (shot.kind === "error") return setNote(shot.message);
    setBusy(true);
    try {
      const r = await engine.sendBattery(shot.dataUrl);
      if (r.ok) {
        const a = readBatteryAnswer(r.body);
        if (!a) setNote("The store's system sent an answer this app doesn't understand. Skip this step — the advisor can check the battery.");
        else setLast({ healthPct: a.healthPct });
      } else if (r.status === 404 || (r.status === 409 && /isn't available/i.test(r.message))) {
        // No reader for this check (an older server, or camera grading off): not the customer skipping.
        setUnavailable(true);
      } else if (r.status === 413) {
        setNote("That picture is too big to send. Choose the screenshot itself, not a photo of it.");
      } else if (r.status === 0) {
        setNote("Couldn't send it — check the Wi‑Fi, then try again.");
      } else if (r.status >= 500 || r.status === 429) {
        setNote("The store's system is busy. Try again in a moment.");
      } else {
        setNote(r.message);
      }
    } finally {
      setBusy(false);
    }
  };

  // The last answer the store recorded is what the step ends with.
  const leave = () => onDone(read != null ? { outcome: "read", healthPct: read } : last ? { outcome: "unreadable", healthPct: null } : { outcome: unavailable ? "unavailable" : "skipped", healthPct: null });

  return (
    <Screen>
      <Kicker>{state.session.storeName}</Kicker>
      <Title>Battery health</Title>
      {unavailable ? (
        <>
          <Note>This store&apos;s system can&apos;t read battery screenshots yet — the advisor checks the battery instead.</Note>
          <View style={{ height: 18 }} />
          <Big title="Continue" onPress={leave} />
        </>
      ) : (
        <>
          <Say>
            Open <Text style={s.strong}>{guide.path}</Text>. Take a screenshot of it, then choose it here.
          </Say>
          {guide.alt ? <Say muted style={{ marginTop: 8 }}>{guide.alt}</Say> : null}
          <Say muted style={{ marginTop: 8 }}>
            To take a screenshot: {guide.screenshot.charAt(0).toLowerCase() + guide.screenshot.slice(1)}
          </Say>
          {guide.settingsAction && Platform.OS === "android" ? (
            <View style={{ marginTop: 16 }}>
              <Big title="Open Settings" kind="secondary" onPress={() => void openAndroidSettings(guide.settingsAction!)} />
            </View>
          ) : null}

          {last ? (
            <View style={[s.result, { borderColor: read != null ? T.pass : T.warn }]}>
              {read != null ? (
                <Text style={s.resultText}>
                  Battery health <Text style={s.resultPct}>{read} %</Text>
                </Text>
              ) : (
                <Text style={[s.resultText, { fontSize: 18 }]}>Couldn&apos;t read it — try a clearer screenshot.</Text>
              )}
            </View>
          ) : null}
          {note ? (
            <View style={{ marginTop: 14 }}>
              <Note tone="warn">{note}</Note>
            </View>
          ) : null}

          <View style={{ height: 20 }} />
          {read != null ? (
            <>
              <Big title="Continue" onPress={leave} disabled={busy} />
              <View style={{ height: 10 }} />
              <Big title={busy ? "Reading the screenshot…" : "Choose a different screenshot"} kind="secondary" onPress={() => void choose()} busy={busy} />
            </>
          ) : (
            <>
              <Big title={busy ? "Reading the screenshot…" : last ? "Choose another screenshot" : "Choose screenshot"} onPress={() => void choose()} busy={busy} />
              <View style={{ height: 10 }} />
              <Big title="Skip" kind="quiet" onPress={leave} disabled={busy} />
            </>
          )}
          <Text style={s.small}>Only the screenshot you choose is sent — nothing else on this phone.</Text>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  strong: { fontWeight: "800", color: T.text },
  result: { marginTop: 20, borderWidth: 1, borderRadius: T.radius, padding: 16, backgroundColor: T.surface },
  resultText: { color: T.text, fontSize: 20, fontWeight: "700", lineHeight: 28 },
  resultPct: { fontSize: 26, fontWeight: "900", color: T.text },
  small: { color: T.muted, fontSize: 14, textAlign: "center", marginTop: 16 },
});
