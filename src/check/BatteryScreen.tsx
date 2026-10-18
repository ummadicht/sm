// Battery health — after Scan, before the phone's own tests (swapup
// docs/PHONE-LED-FLOW.md §4, after GradeIQ v2's battery step). The customer opens
// their phone's battery-health page, takes a screenshot and chooses it here; the
// store's server has GradeIQ read the % off it (POST /api/device/battery) and
// records it — below 80 % it counts against the price as battery drain, so the
// screen only ever shows what was read, never what it means for the offer.
// Optional: Skip is always there. Native and browser (the browser's picker is a
// file input — ./batteryShot.web.ts). Look: the kit — a battery is the hero, and
// once read it shows the % the store recorded.
import React, { useMemo, useState } from "react";
import { Platform, StyleSheet, Text } from "react-native";
import { P } from "../shared/theme";
import { BatteryArt, Caption, Headline, Hero, Lead, Notice, PillButton, QuietLink, Screen } from "../shared/kit";
import { openAndroidSettings } from "../diagnostics/parts";
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
        if (!a) setNote("Unexpected answer — skip; the advisor checks the battery.");
        else setLast({ healthPct: a.healthPct });
      } else if (r.status === 404 || (r.status === 409 && /isn't available/i.test(r.message))) {
        // No reader for this check (an older server, camera grading off, or its AI service out of
        // credit — the server says "isn't available"): not the customer skipping, and not their screenshot.
        setUnavailable(true);
      } else if (r.status === 413) {
        setNote("Too big — choose the screenshot itself.");
      } else if (r.status === 0) {
        setNote("Not sent — check the Wi‑Fi.");
      } else if (r.status >= 500 || r.status === 429) {
        setNote("Store busy — try again soon.");
      } else {
        setNote(r.message);
      }
    } finally {
      setBusy(false);
    }
  };

  // The last answer the store recorded is what the step ends with.
  const leave = () => onDone(read != null ? { outcome: "read", healthPct: read } : last ? { outcome: "unreadable", healthPct: null } : { outcome: unavailable ? "unavailable" : "skipped", healthPct: null });

  if (unavailable) {
    return (
      <Screen footer={<PillButton title="Continue" onPress={leave} />}>
        <Headline>Battery health</Headline>
        <Lead>Can&apos;t read screenshots now — the advisor checks the battery.</Lead>
        <Hero>
          <BatteryArt width={180} level={0.6} />
        </Hero>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        read != null ? (
          <>
            <PillButton title="Continue" onPress={leave} disabled={busy} />
            <PillButton
              title={busy ? "Reading…" : "Choose another"}
              kind="outline"
              arrow={false}
              onPress={() => void choose()}
              busy={busy}
            />
          </>
        ) : (
          <>
            <PillButton title={busy ? "Reading…" : last ? "Choose another" : "Choose screenshot"} onPress={() => void choose()} busy={busy} />
            <QuietLink title="Skip" onPress={leave} disabled={busy} />
          </>
        )
      }
    >
      <Headline>Battery health</Headline>
      <Lead>
        Screenshot <Text style={s.strong}>{guide.path}</Text>, then choose it.
      </Lead>
      {guide.alt ? (
        <Caption center={false} style={{ marginTop: 8 }}>
          {guide.alt}
        </Caption>
      ) : null}
      <Caption center={false} style={{ marginTop: 6 }}>
        Screenshot: {guide.screenshot.charAt(0).toLowerCase() + guide.screenshot.slice(1)}
      </Caption>
      <Hero minHeight={150}>
        <BatteryArt width={190} level={read != null ? read / 100 : 0.62} />
        {read != null ? (
          <Text style={s.read}>
            Battery health <Text style={s.pct}>{read} %</Text>
          </Text>
        ) : null}
        {guide.settingsAction && Platform.OS === "android" ? (
          <PillButton title="Open Settings" kind="outline" size="sm" onPress={() => void openAndroidSettings(guide.settingsAction!)} style={{ marginTop: 22 }} />
        ) : null}
      </Hero>
      {last && read == null ? <Notice tone="warn">Couldn&apos;t read it — try a clearer screenshot.</Notice> : null}
      {note ? <Notice tone="warn" style={{ marginTop: 12 }}>{note}</Notice> : null}
      <Caption>Only this screenshot is sent.</Caption>
    </Screen>
  );
}

const s = StyleSheet.create({
  strong: { fontWeight: "700", color: P.ink },
  // What was read, never what it means for the offer: no good/bad colour.
  read: { color: P.ink, fontSize: 19, fontWeight: "600", marginTop: 16 },
  pct: { fontSize: 24, fontWeight: "800" },
});
