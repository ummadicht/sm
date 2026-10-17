// SwapUp Check screens. The person holding the phone is a customer at a shop
// counter: one decision per screen, big type, plain words, and every failure
// says what to do next. Drawn with the SWAPUP EXPERIENCE CENTER kit
// (src/shared/kit): one headline, one sentence, one visual, one pill button
// docked at the bottom, at most one quiet link; the rest goes in a sheet.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { P } from "../shared/theme";
import { IS_WEB } from "../shared/config";
import {
  Caption,
  Card,
  ChecklistArt,
  FactRow,
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
  TickArt,
  Wordmark,
} from "../shared/kit";
import { Big, Say } from "../diagnostics/parts";
import { TEST_COMPONENTS } from "../diagnostics/tests";
import { testById, type FunctionalTest } from "../diagnostics/catalog";
import type { Snapshot } from "./engine";
import { ClearDataGuide } from "./ClearDataGuide";
import { BATTERY_HEALTH_ID, checkImei, cleanCode, countResults, isValidCode, parseJoinTarget, type CheckState, type Declared, type Outcome, type PlanItem } from "./core";
import { batteryResultText } from "./battery";

/* ─────────────────────────── shared bits ─────────────────────────── */

/** "Sent to the store ✓" / "Waiting for Wi‑Fi…" — the customer should never wonder if their results arrived. */
export function SyncBadge({ snap, center }: { snap: Snapshot; center?: boolean }) {
  const { phase, unsent, message } = snap.sync;
  let text = "Sent to the store ✓";
  let color = P.pass;
  if (phase === "offline") {
    text = unsent ? `Waiting for Wi‑Fi… ${unsent} result${unsent === 1 ? "" : "s"} saved on this phone` : "Waiting for Wi‑Fi…";
    color = P.warn;
  } else if (phase === "sending" || unsent > 0) {
    text = "Sending to the store…";
    color = P.muted;
  } else if (phase === "rejected") {
    text = message || "The store did not accept a result — tell the advisor.";
    color = P.fail;
  } else if (phase === "ended") {
    text = message || "This check has ended.";
    color = P.fail;
  }
  return <Text style={[st.sync, { color }, center && { textAlign: "center" }]}>{text}</Text>;
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
        setScanNote("The camera is needed to scan the store's QR code. You can type the code instead.");
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
              setScanNote("That QR code isn't a SwapUp code. Scan the one the advisor shows under “Test your phone”.");
              return;
            }
            if (t.kind === "wifi") {
              setScanNote("That's the store's Wi‑Fi QR. Join it with your phone's camera app, then scan the “Test your phone” QR here.");
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
          <Text style={st.scanText}>Point the camera at the QR code the advisor shows you.</Text>
          <PillButton title="Type the code instead" kind="outline" arrow={false} onPress={() => setScanning(false)} />
        </View>
      </View>
    );
  }

  return (
    <Screen
      footer={
        <>
          <PillButton
            title={busy ? "Connecting…" : typed ? "Connect" : "Scan the store's QR code"}
            onPress={typed ? () => onJoin(code, null) : () => void startScan()}
            disabled={typed && !valid}
            busy={busy}
          />
          {typed ? (
            <QuietLink title="Scan the QR code instead" onPress={() => void startScan()} disabled={busy} />
          ) : (
            <QuietLink title="No internet on this phone?" onPress={() => setWifiHelp(true)} />
          )}
        </>
      }
    >
      <Wordmark />
      <Headline>Connect to the store</Headline>
      <Lead>Scan the QR code the advisor shows you, or type the 6-letter code.</Lead>
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
        title="No internet on this phone?"
        lead="Ask the advisor for the store's Wi‑Fi QR code and scan it with your camera app first. Then come back here."
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
          <Say muted>
            Say which phone it is, let the advisor&apos;s tablet photograph it, then {n} quick tests — touch, screen, sound, cameras, charging and more. Each
            result goes straight to the advisor, so they can price your trade-in and any repair.
          </Say>
          <Gap h={12} />
          <Say muted>
            The camera and microphone tests ask for permission. A test you can&apos;t or don&apos;t want to do can be skipped — it is then marked &quot;not
            tested&quot;, never &quot;passed&quot;.
          </Say>
        </HelpButton>
      }
      footer={
        <>
          <PillButton title="Start" onPress={onConsent} />
          <QuietLink title="This isn't my store / wrong code" onPress={onLeave} />
          <Caption style={{ marginTop: 0 }}>Trade-in {state.session.caseRef}</Caption>
        </>
      }
    >
      <Wordmark store={state.session.storeName} />
      <Headline>Let&apos;s check your phone</Headline>
      <Lead>About 5 minutes. Each result goes straight to the advisor.</Lead>
      <Hero>
        <ChecklistArt width={130} ticked={2} />
      </Hero>
      <Caption>
        Nothing personal is read. No photos, contacts, messages or accounts leave this phone — only the test results, the phone model
        {IS_WEB ? " and the battery level." : " and its storage size."}
      </Caption>
    </Screen>
  );
}

/* ─────────────────────────── 3. questions ─────────────────────────── */

function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={st.question}>{label}</Text>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
        <Big title="Yes" kind={value === true ? "fail" : "secondary"} onPress={() => onChange(true)} style={{ flex: 1 }} />
        <Big title="No" kind={value === false ? "pass" : "secondary"} onPress={() => onChange(false)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

/**
 * The browser's damage questions. `askImei`: false once the Identify step has
 * asked for it — its answers (IMEI, the phone confirmed or picked, contact) are
 * kept and sent again with these, since the server keeps one declaration.
 */
export function QuestionsScreen({ initial, askImei = true, onDone }: { initial: Declared | null; askImei?: boolean; onDone: (d: Declared) => void }) {
  const [screen, setScreen] = useState<boolean | null>(initial?.screenCracked ?? null);
  const [back, setBack] = useState<boolean | null>(initial?.backCracked ?? null);
  const [liquid, setLiquid] = useState<boolean | null>(initial?.liquid ?? null);
  const [imei, setImei] = useState(initial?.imei ?? "");
  const ic = checkImei(imei);
  const answered = screen !== null && back !== null && liquid !== null;
  const imeiOk = !askImei || ic.ok !== false;
  return (
    <Screen
      footer={
        <>
          <PillButton
            title="Continue to the tests"
            disabled={!answered || !imeiOk}
            onPress={() =>
              onDone({
                ...initial,
                screenCracked: screen,
                backCracked: back,
                liquid,
                imei: askImei ? (ic.ok === true ? ic.imei : null) : initial?.imei ?? null,
              })
            }
          />
          {!answered ? <Caption style={{ marginTop: 0 }}>Answer the three questions to continue.</Caption> : null}
        </>
      }
    >
      <Headline>A few questions</Headline>
      <Lead>What a phone can&apos;t test on itself.</Lead>
      <Gap h={26} />
      <YesNo label="Is the screen glass cracked?" value={screen} onChange={setScreen} />
      <YesNo label="Is the back glass cracked?" value={back} onChange={setBack} />
      <YesNo label="Has the phone been in water or other liquid?" value={liquid} onChange={setLiquid} />
      {askImei ? (
        <>
          <Label style={{ marginTop: 6 }}>IMEI (optional)</Label>
          <Caption center={false} style={{ marginTop: 0, marginBottom: 10 }}>
            Dial *#06# — the phone shows its IMEI. Type the 15 digits, or leave it for the advisor.
          </Caption>
          <Field big="digits" value={imei} onChangeText={(t) => setImei(t.replace(/\D/g, "").slice(0, 15))} keyboardType="number-pad" placeholder="15 digits" accessibilityLabel="IMEI" />
          {ic.ok === false ? (
            <Caption center={false} tone="fail" style={{ fontWeight: "600" }}>
              {ic.message}
            </Caption>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

/* ─────────────────────────── 4. runner ─────────────────────────── */

/**
 * The plan's tests this browser can run, and the ones it can't (reported as
 * such). battery_health is neither: it is the battery screenshot step, whose
 * result the server records itself.
 */
export function supportedPlan(plan: PlanItem[]): { runnable: PlanItem[]; unsupported: PlanItem[] } {
  const runnable: PlanItem[] = [];
  const unsupported: PlanItem[] = [];
  for (const p of plan) {
    if (p.id === BATTERY_HEALTH_ID) continue;
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
            Alert.alert("Stop testing?", "Your results so far are kept. You can carry on later from where you stopped.", [
              { text: "Keep testing", style: "cancel" },
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

/* ─────────────────────────── 5. done ─────────────────────────── */

export function DoneScreen({
  snap,
  onRerun,
  onNewCheck,
}: {
  snap: Snapshot;
  onRerun: (ids: string[]) => void;
  onNewCheck: () => void;
}) {
  const s = snap.state!;
  const c = countResults(s.session.plan, s.results);
  const remote = snap.remote;
  const applied = remote?.status === "applied";
  const redo = s.session.plan.filter((p) => {
    const o = s.results[p.id]?.outcome;
    return (o === "fail" || o === "skip") && TEST_COMPONENTS[p.id];
  });
  const photos = s.pairing?.outcome;
  const rows: { label: string; value: string; tone?: "pass" | "fail" | "warn" | "muted" }[] = [
    { label: "Trade-in", value: s.session.caseRef },
    { label: "Passed", value: String(c.passed), tone: "pass" },
    { label: "Failed", value: String(c.failed), tone: c.failed ? "fail" : undefined },
    { label: "Skipped", value: String(c.skipped), tone: c.skipped ? "warn" : undefined },
  ];
  if (c.unsupported) rows.push({ label: IS_WEB ? "Can't test in this browser" : "Can't run on this phone", value: String(c.unsupported), tone: "muted" });
  if (photos) rows.push({ label: "Screen and glass", value: photos === "handoff" || photos === "grace" ? "checked by the store's camera" : "checked by eye", tone: "muted" });
  if (s.battery) rows.push({ label: "Battery health", value: batteryResultText(s.battery), tone: "muted" });
  return (
    <Screen
      footer={
        <>
          {redo.length && !applied ? (
            <PillButton title={`Run ${redo.length === 1 ? "that test" : `those ${redo.length} tests`} again`} kind="outline" onPress={() => onRerun(redo.map((p) => p.id))} />
          ) : null}
          <QuietLink title="Finish and start a new check" onPress={onNewCheck} />
        </>
      }
    >
      <Wordmark store={s.session.storeName} />
      {/* Never a price or a grade letter here: the price comes from the store and can still change. */}
      <Headline>{applied ? "The store has your results" : "Checks complete"}</Headline>
      {!applied ? <Lead>The advisor will confirm your price.</Lead> : null}
      <Hero grow={false} minHeight={0} style={{ paddingVertical: 24 }}>
        {applied ? <TickArt width={104} /> : <ChecklistArt width={92} ticked={3} />}
      </Hero>
      <Card pad={false} style={st.facts}>
        {rows.map((r, i) => (
          <FactRow key={r.label} label={r.label} value={r.value} tone={r.tone} last={i === rows.length - 1} />
        ))}
      </Card>
      <Gap h={14} />
      <SyncBadge snap={snap} center />
      {!applied ? <Caption>The advisor is reviewing your results on their screen.</Caption> : null}
      <ClearDataGuide applied={applied} />
      {redo.length && !applied ? <Caption>Failed or skipped: {redo.map((p) => p.name).join(", ")}</Caption> : null}
    </Screen>
  );
}

/* ─────────────────────────── ended ─────────────────────────── */

export function EndedScreen({ message, applied, onNew }: { message: string; applied?: boolean; onNew: () => void }) {
  if (applied) {
    // The store applied the results (see APPLIED_MESSAGE): a finish, not an error.
    return (
      <Screen footer={<PillButton title="Test another phone" onPress={onNew} />}>
        <Wordmark />
        <Headline>The store has your results</Headline>
        <Lead>{message}</Lead>
        <Hero minHeight={150}>
          <TickArt width={120} />
        </Hero>
        <ClearDataGuide applied />
      </Screen>
    );
  }
  return (
    <Screen footer={<PillButton title="Connect with a new code" onPress={onNew} />}>
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
  question: { color: P.ink, fontSize: 17, lineHeight: 24, fontWeight: "600" },
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
  facts: { paddingHorizontal: 20 },
});
