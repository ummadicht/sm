// SwapUp Check screens. The person holding the phone is a customer at a shop
// counter: one decision per screen, big type, plain words, and every failure
// says what to do next. Drawn with the SWAPUP EXPERIENCE CENTER kit
// (src/shared/kit): one headline, one sentence, one visual, one pill button
// docked at the bottom, at most one quiet link; the rest goes in a sheet.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { P } from "../shared/theme";
import {
  Caption,
  ChecklistArt,
  Field,
  Gap,
  Headline,
  HelpButton,
  Hero,
  Label,
  Lead,
  Notice,
  PhoneArt,
  PillButton,
  QuietLink,
  ScanArt,
  Screen,
  Sheet,
  Wordmark,
} from "../shared/kit";
import { Say } from "../diagnostics/parts";
import { TEST_COMPONENTS } from "../diagnostics/tests";
import { testById, type FunctionalTest } from "../diagnostics/catalog";
import { APPLIED_MESSAGE, type Snapshot } from "./engine";
import { cleanCode, isValidCode, parseJoinTarget, type CheckState, type Outcome, type PlanItem } from "./core";
import { SERVER_DECIDES } from "../diagnostics/auto/plan";
import { type CustomerReport } from "./report";
import { PRIVACY_LINE } from "./copy";

/* ─────────────────────────── shared bits ─────────────────────────── */

/** "Sent to the store ✓" / "Waiting for Wi‑Fi…" — the customer should never wonder if their results arrived. */
export function SyncBadge({ snap, center }: { snap: Snapshot; center?: boolean }) {
  const { phase, unsent, message } = snap.sync;
  let text = "Sent to the store ✓";
  let color = P.pass;
  if (phase === "offline") {
    text = unsent ? `Waiting for Wi‑Fi… ${unsent} saved` : "Waiting for Wi‑Fi…";
    color = P.warn;
  } else if (phase === "sending" || unsent > 0) {
    text = "Sending to the store…";
    color = P.muted;
  } else if (phase === "rejected") {
    text = message || "A result was refused — tell the advisor.";
    color = P.fail;
  } else if (phase === "ended" && message !== APPLIED_MESSAGE) {
    // Applied is a finish, not an error: the results are with the store.
    text = message || "This check has ended.";
    color = P.fail;
  }
  return <Text style={[st.sync, { color }, center && { textAlign: "center" }]}>{text}</Text>;
}

/**
 * "See the grade report": the public grade report in the phone's own browser, once the
 * store has applied the results (grading spec §5). It explains what was tested and why the
 * phone got its SwapUp grade (the page itself has no prices — the answer on the result screen
 * carries them). A small outline pill, not a second quiet link.
 */
export function ReportLink({ report, style }: { report: CustomerReport | null; style?: React.ComponentProps<typeof PillButton>["style"] }) {
  if (!report) return null;
  return (
    <PillButton
      title="See the grade report"
      kind="outline"
      size="sm"
      arrow
      onPress={() => void Linking.openURL(report.url).catch(() => {})}
      style={{ alignSelf: "center", ...style }}
    />
  );
}

/* ─────────────────────────── 1. join ─────────────────────────── */

export function JoinScreen({
  busy,
  error,
  initialCode,
  onJoin,
}: {
  busy: boolean;
  error: string | null;
  initialCode?: string;
  onJoin: (code: string, server: string | null) => void;
}) {
  const [code, setCode] = useState(initialCode ?? "");
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [wifiHelp, setWifiHelp] = useState(false);
  const [perm, requestPerm] = useCameraPermissions();
  const handled = useRef(false);
  const valid = isValidCode(code);
  const typed = code.length > 0;

  async function startScan() {
    setScanNote(null);
    if (!perm?.granted) {
      const r = await requestPerm();
      if (!r.granted) {
        setScanNote("No camera access — type the code instead.");
        return;
      }
    }
    handled.current = false;
    setScanning(true);
  }

  if (scanning) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => {
            if (handled.current) return;
            const t = parseJoinTarget(data);
            if (!t) {
              setScanNote("Not a SwapUp code — scan “Test your phone”.");
              return;
            }
            if (t.kind === "wifi") {
              setScanNote("That's the Wi‑Fi QR — join it with your camera first.");
              return;
            }
            handled.current = true;
            setScanning(false);
            setCode(t.code);
            onJoin(t.code, t.server);
          }}
        />
        <View style={st.scanBar}>
          {scanNote ? <Notice tone="warn" style={{ marginBottom: 12 }}>{scanNote}</Notice> : null}
          <Text style={st.scanText}>Point at the advisor's QR code.</Text>
          <PillButton title="Type the code" kind="outline" arrow={false} onPress={() => setScanning(false)} />
        </View>
      </View>
    );
  }

  return (
    <Screen
      footer={
        <>
          <PillButton
            title={busy ? "Connecting…" : typed ? "Connect" : "Scan the QR code"}
            onPress={typed ? () => onJoin(code, null) : () => void startScan()}
            disabled={typed && !valid}
            busy={busy}
          />
          {typed ? (
            <QuietLink title="Scan instead" onPress={() => void startScan()} disabled={busy} />
          ) : (
            <QuietLink title="No internet?" onPress={() => setWifiHelp(true)} />
          )}
        </>
      }
    >
      <Wordmark />
      <Headline>Connect to the store</Headline>
      <Lead>Scan the advisor's QR, or type the code.</Lead>
      <Hero minHeight={150}>
        <ScanArt width={210} />
      </Hero>
      <Label>Or type the code</Label>
      <Field
        big="code"
        value={code}
        onChangeText={(t) => setCode(cleanCode(t).code)}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
        placeholder="ABC123"
        editable={!busy}
        returnKeyType="go"
        onSubmitEditing={() => valid && onJoin(code, null)}
        accessibilityLabel="The store's code"
      />
      {scanNote ? <Notice tone="warn" style={{ marginTop: 12 }}>{scanNote}</Notice> : null}
      {error ? <Notice tone="fail" style={{ marginTop: 12 }}>{error}</Notice> : null}
      <Sheet
        visible={wifiHelp}
        onClose={() => setWifiHelp(false)}
        title="No internet?"
        lead="Scan the store's Wi‑Fi QR with your camera, then come back."
        footer={<PillButton title="Got it" onPress={() => setWifiHelp(false)} />}
      />
    </Screen>
  );
}

/* ─────────────────────────── 2. welcome ─────────────────────────── */

export function WelcomeScreen({ state, onConsent, onLeave }: { state: CheckState; onConsent: () => void; onLeave: () => void }) {
  const n = supportedPlan(state.session.plan).runnable.length;
  return (
    <Screen
      topRight={
        <HelpButton title="What happens" label="What happens in this check">
          <Say muted>The store photographs your phone, then {n} quick tests run.</Say>
          <Gap h={12} />
          <Say muted>A skipped test is marked &quot;not tested&quot;, never &quot;passed&quot;.</Say>
        </HelpButton>
      }
      footer={
        <>
          <PillButton title="Start" onPress={onConsent} />
          <QuietLink title="Wrong store?" onPress={onLeave} />
          <Caption style={{ marginTop: 0 }}>Trade-in {state.session.caseRef}</Caption>
        </>
      }
    >
      <Wordmark store={state.session.storeName} />
      <Headline>Let&apos;s check your phone</Headline>
      <Lead>About 5 minutes.</Lead>
      <Hero>
        <ChecklistArt width={130} ticked={2} />
      </Hero>
      <Caption>{PRIVACY_LINE}</Caption>
    </Screen>
  );
}

/* ─────────────────────────── 4. runner ─────────────────────────── */

/**
 * The plan's tests this browser can run, and the ones it can't (reported as
 * such). The server's own are neither (../diagnostics/auto/plan.ts SERVER_DECIDES):
 * battery_health is the battery screenshot step, whose result the server records,
 * and display is the store camera's sweep or the advisor's certification — the
 * customer is never asked whether the screen looked clean.
 */
export function supportedPlan(plan: PlanItem[]): { runnable: PlanItem[]; unsupported: PlanItem[] } {
  const runnable: PlanItem[] = [];
  const unsupported: PlanItem[] = [];
  for (const p of plan) {
    if ((SERVER_DECIDES as readonly string[]).includes(p.id)) continue;
    (TEST_COMPONENTS[p.id] && testById(p.id) ? runnable : unsupported).push(p);
  }
  return { runnable, unsupported };
}

export function RunnerScreen({
  snap,
  only,
  onResult,
  onAllDone,
  onQuit,
}: {
  snap: Snapshot;
  /** When set, re-run just these tests (from the Done screen). */
  only: string[] | null;
  onResult: (id: string, outcome: Outcome, detail: Record<string, string | number | boolean | null> | null) => void;
  onAllDone: () => void;
  onQuit: () => void;
}) {
  const st0 = snap.state!;
  const { runnable } = useMemo(() => supportedPlan(st0.session.plan), [st0.session.plan]);
  const queue = only ? runnable.filter((p) => only.includes(p.id)) : runnable;
  // In a re-run, step through `only` in order regardless of earlier results.
  const [rerunIndex, setRerunIndex] = useState(0);
  const current = only ? queue[rerunIndex] : queue.find((p) => !st0.results[p.id]);
  const index = current ? queue.indexOf(current) : queue.length;

  useEffect(() => {
    if (!current) onAllDone();
  }, [current, onAllDone]);

  if (!current) {
    return (
      <View style={st.center}>
        <ActivityIndicator color={P.primary} />
      </View>
    );
  }
  const Comp = TEST_COMPONENTS[current.id];
  const test = testById(current.id) as FunctionalTest;
  return (
    <View style={{ flex: 1, backgroundColor: P.bg }}>
      <View style={st.runnerTop}>
        <Text style={st.progress}>
          Test {index + 1} of {queue.length}
        </Text>
        <View style={{ flexShrink: 1 }}>
          <SyncBadge snap={snap} />
        </View>
        <Text
          style={st.quit}
          accessibilityRole="button"
          onPress={() =>
            Alert.alert("Pause testing?", "Your results so far are kept.", [
              { text: "Keep going", style: "cancel" },
              { text: "Stop", style: "destructive", onPress: onQuit },
            ])
          }
        >
          Pause
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Comp
          key={`${current.id}-${only ? rerunIndex : "main"}`}
          test={test}
          index={index}
          count={queue.length}
          onResult={(r, detail) => {
            const { durationSec, ...rest } = (detail ?? {}) as Record<string, string | number | boolean | null>;
            void durationSec;
            onResult(current.id, r, Object.keys(rest).length ? rest : null);
            if (only) setRerunIndex((i) => i + 1);
          }}
        />
      </View>
    </View>
  );
}

/* 5. the result: ./ResultScreen.tsx — one screen for the native app and the browser. */

/* ─────────────────────────── ended ─────────────────────────── */

/** A check that ended any other way (closed or timed out at the store). Applied is a finish: ./ResultScreen.tsx. */
export function EndedScreen({ message, onNew }: { message: string; onNew: () => void }) {
  return (
    <Screen footer={<PillButton title="New code" onPress={onNew} />}>
      <Wordmark />
      <Headline>This check has ended</Headline>
      <Notice tone="warn" style={{ marginTop: 16 }}>
        {message}
      </Notice>
      <Hero>
        <PhoneArt width={96} />
      </Hero>
    </Screen>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: P.bg },
  sync: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  scanBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 26,
    backgroundColor: P.surface,
    borderTopLeftRadius: P.radius,
    borderTopRightRadius: P.radius,
  },
  scanText: { color: P.ink, fontSize: 17, lineHeight: 24, fontWeight: "600", marginBottom: 14 },
  runnerTop: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: P.bg },
  progress: { color: P.ink, fontSize: 15, fontWeight: "700" },
  quit: { marginLeft: "auto", color: P.primary, fontSize: 15, fontWeight: "700", paddingVertical: 6, paddingHorizontal: 4 },
});
