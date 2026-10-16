// SwapUp Check screens. The person holding the phone is a customer at a shop
// counter: one decision per screen, big type, plain words, and every failure
// says what to do next.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { T } from "../shared/theme";
import { IS_WEB } from "../shared/config";
import { Big, Fact, Say, BigEmoji } from "../diagnostics/parts";
import { TEST_COMPONENTS } from "../diagnostics/tests";
import { testById, type FunctionalTest } from "../diagnostics/catalog";
import type { CheckEngine, Snapshot } from "./engine";
import { ClearDataGuide } from "./ClearDataGuide";
import { checkImei, cleanCode, countResults, isValidCode, parseJoinTarget, type CheckState, type Declared, type Outcome, type PlanItem } from "./core";

/* ─────────────────────────── shared bits ─────────────────────────── */

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  if (!scroll) return <View style={st.screen}>{children}</View>;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.bg }} contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={st.title}>{children}</Text>;
}

export function Kicker({ children }: { children: React.ReactNode }) {
  return <Text style={st.kicker}>{children}</Text>;
}

export function Note({ tone = "info", children }: { tone?: "info" | "bad" | "ok" | "warn"; children: React.ReactNode }) {
  const border = tone === "bad" ? T.fail : tone === "ok" ? T.pass : tone === "warn" ? T.warn : T.border;
  return (
    <View style={[st.note, { borderColor: border }]}>
      <Text style={st.noteText}>{children}</Text>
    </View>
  );
}

/** "Sent to the store ✓" / "Waiting for Wi‑Fi…" — the customer should never wonder if their results arrived. */
export function SyncBadge({ snap }: { snap: Snapshot }) {
  const { phase, unsent, message } = snap.sync;
  let text = "Sent to the store ✓";
  let color = T.pass;
  if (phase === "offline") {
    text = unsent ? `Waiting for Wi‑Fi… ${unsent} result${unsent === 1 ? "" : "s"} saved on this phone` : "Waiting for Wi‑Fi…";
    color = T.warn;
  } else if (phase === "sending" || unsent > 0) {
    text = "Sending to the store…";
    color = T.muted;
  } else if (phase === "rejected") {
    text = message || "The store did not accept a result — tell the advisor.";
    color = T.fail;
  } else if (phase === "ended") {
    text = message || "This check has ended.";
    color = T.fail;
  }
  return <Text style={[st.sync, { color }]}>{text}</Text>;
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
  const [perm, requestPerm] = useCameraPermissions();
  const handled = useRef(false);
  const valid = isValidCode(code);

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
          {scanNote ? <Text style={[st.noteText, { color: T.warn, marginBottom: 12 }]}>{scanNote}</Text> : null}
          <Text style={[st.noteText, { marginBottom: 12 }]}>Point the camera at the QR code the advisor shows you.</Text>
          <Big title="Type the code instead" kind="secondary" onPress={() => setScanning(false)} />
        </View>
      </View>
    );
  }

  return (
    <Screen>
      <Kicker>SwapUp Check</Kicker>
      <Title>Connect to the store</Title>
      <Say muted>The advisor shows a QR code and a 6-letter code. Scan the QR, or type the code.</Say>
      <View style={{ height: 22 }} />
      <Big title="Scan the store's QR code" onPress={startScan} disabled={busy} />
      {scanNote ? (
        <View style={{ marginTop: 12 }}>
          <Note tone="warn">{scanNote}</Note>
        </View>
      ) : null}
      <View style={{ height: 26 }} />
      <Text style={st.label}>Or type the code</Text>
      <TextInput
        value={code}
        onChangeText={(t) => setCode(cleanCode(t).code)}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
        placeholder="ABC123"
        placeholderTextColor={T.skip}
        style={st.codeInput}
        editable={!busy}
        returnKeyType="go"
        onSubmitEditing={() => valid && onJoin(code, null)}
      />
      <View style={{ height: 14 }} />
      <Big title={busy ? "Connecting…" : "Connect"} onPress={() => onJoin(code, null)} disabled={!valid || busy} busy={busy} />
      {error ? (
        <View style={{ marginTop: 16 }}>
          <Note tone="bad">{error}</Note>
        </View>
      ) : null}
      <View style={{ height: 20 }} />
      <Say muted>No internet on this phone? Ask the advisor for the store's Wi‑Fi QR code and scan it with your camera app first.</Say>
    </Screen>
  );
}

/* ─────────────────────────── 2. welcome ─────────────────────────── */

export function WelcomeScreen({ state, onConsent, onLeave }: { state: CheckState; onConsent: () => void; onLeave: () => void }) {
  const n = state.session.plan.length;
  return (
    <Screen>
      <Kicker>{state.session.storeName}</Kicker>
      <Title>Let's check your phone</Title>
      <Say>
        About 5 minutes. {n} quick tests — touch, screen, sound, cameras, charging and more. Each result goes straight to the advisor, so they can price
        your trade-in and any repair.
      </Say>
      <View style={{ height: 18 }} />
      <Note tone="ok">
        Nothing personal is read. No photos, contacts, messages or accounts leave this phone — only the test results, the phone model
        {IS_WEB ? " and the battery level." : " and its storage size."}
      </Note>
      <View style={{ height: 10 }} />
      <Note>The camera and microphone tests ask for permission. A test you can't or don't want to do can be skipped — it is then marked "not tested", never "passed".</Note>
      <View style={{ height: 24 }} />
      <Big title="Start" onPress={onConsent} />
      <View style={{ height: 10 }} />
      <Big title="This isn't my store / wrong code" kind="quiet" onPress={onLeave} />
      <Text style={st.ref}>Trade-in {state.session.caseRef}</Text>
    </Screen>
  );
}

/* ─────────────────────────── 3. questions ─────────────────────────── */

function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Say>{label}</Say>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
        <Big title="Yes" kind={value === true ? "fail" : "secondary"} onPress={() => onChange(true)} style={{ flex: 1 }} />
        <Big title="No" kind={value === false ? "pass" : "secondary"} onPress={() => onChange(false)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

export function QuestionsScreen({ initial, onDone }: { initial: Declared | null; onDone: (d: Declared) => void }) {
  const [screen, setScreen] = useState<boolean | null>(initial?.screenCracked ?? null);
  const [back, setBack] = useState<boolean | null>(initial?.backCracked ?? null);
  const [liquid, setLiquid] = useState<boolean | null>(initial?.liquid ?? null);
  const [imei, setImei] = useState(initial?.imei ?? "");
  const ic = checkImei(imei);
  const answered = screen !== null && back !== null && liquid !== null;
  const imeiOk = ic.ok !== false;
  return (
    <Screen>
      <Kicker>A few questions</Kicker>
      <Title>What a phone can't test on itself</Title>
      <YesNo label="Is the screen glass cracked?" value={screen} onChange={setScreen} />
      <YesNo label="Is the back glass cracked?" value={back} onChange={setBack} />
      <YesNo label="Has the phone been in water or other liquid?" value={liquid} onChange={setLiquid} />
      <Text style={st.label}>IMEI (optional)</Text>
      <Say muted>Dial *#06# — the phone shows its IMEI. Type the 15 digits, or leave it for the advisor.</Say>
      <TextInput
        value={imei}
        onChangeText={(t) => setImei(t.replace(/\D/g, "").slice(0, 15))}
        keyboardType="number-pad"
        placeholder="15 digits"
        placeholderTextColor={T.skip}
        style={[st.codeInput, { fontSize: 22, letterSpacing: 2 }]}
      />
      {ic.ok === false ? <Text style={[st.noteText, { color: T.fail, marginTop: 8 }]}>{ic.message}</Text> : null}
      <View style={{ height: 20 }} />
      <Big
        title="Continue to the tests"
        disabled={!answered || !imeiOk}
        onPress={() => onDone({ screenCracked: screen, backCracked: back, liquid, imei: ic.ok === true ? ic.imei : null })}
      />
      {!answered ? <Text style={[st.ref, { marginTop: 10 }]}>Answer the three questions to continue.</Text> : null}
    </Screen>
  );
}

/* ─────────────────────────── 4. runner ─────────────────────────── */

export function supportedPlan(plan: PlanItem[]): { runnable: PlanItem[]; unsupported: PlanItem[] } {
  const runnable: PlanItem[] = [];
  const unsupported: PlanItem[] = [];
  for (const p of plan) (TEST_COMPONENTS[p.id] && testById(p.id) ? runnable : unsupported).push(p);
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
      <Screen scroll={false}>
        <ActivityIndicator color={T.accent} />
      </Screen>
    );
  }
  const Comp = TEST_COMPONENTS[current.id];
  const test = testById(current.id) as FunctionalTest;
  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <View style={st.runnerTop}>
        <Text style={st.progress}>
          Test {index + 1} of {queue.length}
        </Text>
        <SyncBadge snap={snap} />
        <Text
          style={st.quit}
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
  return (
    <Screen>
      <BigEmoji>{applied ? "✅" : "📱"}</BigEmoji>
      <Title>{applied ? "The store has your results" : "All done — show this to the advisor"}</Title>
      <Text style={st.bigRef}>{s.session.caseRef}</Text>
      <Say muted center>
        {s.session.storeName}
      </Say>
      <View style={{ height: 18 }} />
      <View style={st.card}>
        <Fact label="Passed" value={String(c.passed)} tone="pass" />
        <Fact label="Failed" value={String(c.failed)} tone={c.failed ? "fail" : undefined} />
        <Fact label="Skipped" value={String(c.skipped)} tone={c.skipped ? "warn" : undefined} />
        {c.unsupported ? <Fact label={IS_WEB ? "Can't test in this browser" : "Can't run on this phone"} value={String(c.unsupported)} tone="skip" /> : null}
      </View>
      <View style={{ height: 12 }} />
      <SyncBadge snap={snap} />
      {!applied ? <Say muted>The advisor is reviewing your results on their screen.</Say> : null}
      <ClearDataGuide applied={applied} />
      {redo.length && !applied ? (
        <>
          <View style={{ height: 18 }} />
          <Big title={`Run ${redo.length === 1 ? "that test" : `those ${redo.length} tests`} again`} kind="secondary" onPress={() => onRerun(redo.map((p) => p.id))} />
          <Text style={st.ref}>Failed or skipped: {redo.map((p) => p.name).join(", ")}</Text>
        </>
      ) : null}
      <View style={{ height: 26 }} />
      <Big title="Finish and start a new check" kind="quiet" onPress={onNewCheck} />
    </Screen>
  );
}

/* ─────────────────────────── ended ─────────────────────────── */

export function EndedScreen({ message, applied, onNew }: { message: string; applied?: boolean; onNew: () => void }) {
  if (applied) {
    // The store applied the results (see APPLIED_MESSAGE): a finish, not an error.
    return (
      <Screen>
        <BigEmoji>✅</BigEmoji>
        <Title>The store has your results</Title>
        <Note tone="ok">{message}</Note>
        <ClearDataGuide applied />
        <View style={{ height: 18 }} />
        <Big title="Test another phone" onPress={onNew} />
      </Screen>
    );
  }
  return (
    <Screen>
      <Title>This check has ended</Title>
      <Note tone="warn">{message}</Note>
      <View style={{ height: 18 }} />
      <Big title="Connect with a new code" onPress={onNew} />
    </Screen>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.bg, padding: 22, justifyContent: "center" },
  scroll: { padding: 22, paddingTop: 30, paddingBottom: 48 },
  kicker: { color: T.accent, fontSize: 14, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 },
  title: { color: T.text, fontSize: 30, fontWeight: "800", lineHeight: 36, marginBottom: 14 },
  label: { color: T.text, fontSize: 16, fontWeight: "700", marginBottom: 8 },
  codeInput: {
    backgroundColor: T.surface,
    borderColor: T.border,
    borderWidth: 1,
    borderRadius: T.radius,
    color: T.text,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: 8,
    textAlign: "center",
    paddingVertical: 14,
    marginTop: 8,
  },
  note: { borderWidth: 1, borderRadius: T.radius, padding: 14, backgroundColor: T.surface },
  noteText: { color: T.text, fontSize: 16, lineHeight: 23 },
  sync: { fontSize: 14, fontWeight: "700" },
  scanBar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: "#000c" },
  runnerTop: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border },
  progress: { color: T.text, fontSize: 15, fontWeight: "800" },
  quit: { marginLeft: "auto", color: T.muted, fontSize: 15, fontWeight: "700", paddingVertical: 6, paddingHorizontal: 4 },
  card: { backgroundColor: T.surface, borderRadius: T.radius, paddingHorizontal: 16, borderWidth: 1, borderColor: T.border },
  ref: { color: T.muted, fontSize: 14, textAlign: "center", marginTop: 14 },
  bigRef: { color: T.text, fontSize: 22, fontWeight: "800", textAlign: "center", marginBottom: 4 },
});
