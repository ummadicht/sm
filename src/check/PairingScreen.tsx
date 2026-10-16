// Native SwapUp Check, step 2: "Lay your phone on the counter, screen up — the
// advisor will photograph it." The store device runs GradeIQ's camera page
// (/v2/cam) and asks this screen for patterns (white, black, stripes, colours…)
// through SwapUp's /api/device/screen; this phone draws each one full-screen
// and echoes what it is ACTUALLY drawing. Mirrors GradeIQ's own primary phone
// (giq/app/components/V2Flow.tsx 236-275, 794-808). Pure decisions: ../diagnostics/auto/pairing.ts.
//
// The permissions the automatic tests need are asked for here, BEFORE the first
// echo: the store's camera button stays locked until this phone echoes, so a
// permission dialog can never cover a pattern mid-sweep.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Brightness from "expo-brightness";
import { Camera } from "expo-camera";
import { requestRecordingPermissionsAsync } from "expo-audio";
import * as Location from "expo-location";
import { T } from "../shared/theme";
import { Big, Say } from "../diagnostics/parts";
import {
  PATTERN_FILLS,
  POLL_MS,
  STRIPE_PX,
  displayablePattern,
  needsEcho,
  newTracker,
  parseScreen,
  skipOffer,
  trackPoll,
  trackRefusal,
  type ScreenPoll,
  type Tracker,
} from "../diagnostics/auto/pairing";
import type { CheckEngine } from "./engine";
import type { CheckState, PairingRec } from "./core";

type Props = {
  engine: CheckEngine;
  state: CheckState;
  onDone: (rec: Omit<PairingRec, "at">) => void;
  /** Full-bleed while a pattern is up (the app drops its safe-area padding and hides the status bar). */
  onBleed: (on: boolean) => void;
  onWrongCode: () => void;
};

async function askPermissions() {
  // Each one shows the system dialog only if the customer hasn't answered it before.
  await Camera.requestCameraPermissionsAsync().catch(() => null);
  await requestRecordingPermissionsAsync().catch(() => null);
  await Location.requestForegroundPermissionsAsync().catch(() => null);
}

export function PairingScreen({ engine, state, onDone, onBleed, onWrongCode }: Props) {
  const [ready, setReady] = useState(false);
  const [drawing, setDrawing] = useState("idle");
  const [poll, setPoll] = useState<ScreenPoll | null>(null);
  const [offline, setOffline] = useState(false);
  const [offer, setOffer] = useState<ReturnType<typeof skipOffer>>(null);
  const tracker = useRef<Tracker>(newTracker(Date.now()));
  const drawingRef = useRef("idle");
  const lastEcho = useRef<{ shown: string; at: number } | null>(null);
  const left = useRef(false);
  const cbs = useRef({ onDone, onBleed });
  cbs.current = { onDone, onBleed };

  const leave = useCallback((rec: Omit<PairingRec, "at">) => {
    if (left.current) return;
    left.current = true;
    cbs.current.onBleed(false);
    cbs.current.onDone(rec);
  }, []);

  // Max brightness for the camera; the phone's own setting comes back afterwards.
  useEffect(() => {
    let prev: number | null = null;
    Brightness.getBrightnessAsync()
      .then((b) => {
        prev = b;
        return Brightness.setBrightnessAsync(1);
      })
      .catch(() => {});
    return () => {
      if (Platform.OS === "android") Brightness.restoreSystemBrightnessAsync().catch(() => {});
      else if (prev != null) Brightness.setBrightnessAsync(prev).catch(() => {});
      cbs.current.onBleed(false);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    askPermissions().finally(() => {
      if (!alive) return;
      tracker.current = newTracker(Date.now());
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const echo = useCallback(
    (shown: string) => {
      lastEcho.current = { shown, at: Date.now() };
      void engine.screenShown(shown);
    },
    [engine]
  );

  // Echo what is on screen once it has been drawn (a pattern needs a frame or two to land).
  useEffect(() => {
    if (!ready) return;
    drawingRef.current = drawing;
    cbs.current.onBleed(drawing !== "idle");
    const t = setTimeout(() => echo(drawing), drawing === "idle" ? 30 : 180);
    return () => clearTimeout(t);
  }, [drawing, ready, echo]);

  // Poll ~700 ms (setTimeout chain: a slow answer never overlaps the next request).
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const started = Date.now();
      const r = await engine.screenPoll();
      if (!alive || left.current) return;
      const now = Date.now();
      if (r.ok) {
        const p = parseScreen(r.body);
        if (!p) {
          const t = trackRefusal(tracker.current, now);
          tracker.current = t.tracker;
          if (t.unavailable) return leave({ outcome: "unavailable", reason: "the store's system sent an answer this app doesn't understand" });
        } else {
          setOffline(false);
          const t = trackPoll(tracker.current, p, now);
          tracker.current = t.tracker;
          setPoll(p);
          if (t.leave) return leave({ outcome: t.leave, reason: null });
          const want = displayablePattern(p.pattern);
          if (want !== drawingRef.current) setDrawing(want);
          else if (needsEcho(p, want) && (!lastEcho.current || now - lastEcho.current.at > 1500)) echo(want);
        }
      } else if (r.status === 0 || r.status >= 500 || r.status === 429) {
        setOffline(true);
      } else if (r.status !== 401 && r.status !== 403) {
        // The server said no (no camera grading for this check, or an older server without the route).
        const t = trackRefusal(tracker.current, now);
        tracker.current = t.tracker;
        if (t.unavailable) return leave({ outcome: "unavailable", reason: r.message || `the store's system refused the photo check (${r.status})` });
      }
      setOffer(skipOffer(tracker.current, now));
      timer = setTimeout(tick, Math.max(0, POLL_MS - (Date.now() - started)));
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [ready, engine, echo, leave]);

  if (ready && drawing !== "idle") return <Pattern name={drawing} />;

  const connected = tracker.current.connectedAt != null;
  const retake = poll?.capture?.verdict === "retake" || poll?.capture?.verdict === "retaking";
  const statusLine = !ready
    ? "One moment — allow the camera, microphone and location when asked, so the tests can run by themselves."
    : offline
      ? "Waiting for Wi‑Fi…"
      : poll?.cosmeticDone
        ? "Photos accepted — finishing the screen check…"
        : retake
          ? "The advisor is retaking the photos."
          : connected
            ? "Connected — the advisor is taking photos. Keep the phone still."
            : "Waiting for the advisor's camera…";

  return (
    <View style={s.root}>
      <Text style={s.kicker}>{state.session.storeName}</Text>
      <Text style={s.title}>Lay your phone on the counter, screen up</Text>
      <Say>The advisor will photograph it. Then the tests run by themselves.</Say>
      <View style={s.phone}>
        <View style={s.phoneScreen} />
      </View>
      <View style={[s.status, { borderColor: connected ? T.pass : T.border }]}>
        <View style={[s.dot, { backgroundColor: offline ? T.warn : connected ? T.pass : T.muted }]} />
        <Text style={s.statusText}>{statusLine}</Text>
      </View>
      <Text style={s.privacy}>
        Nothing personal is read. No photos, contacts, messages, accounts or location leave this phone — only the test results, the phone model and its storage size.
      </Text>
      <View style={{ flex: 1 }} />
      {offer ? (
        <>
          <Big
            title="Continue without photos"
            kind="secondary"
            onPress={() =>
              leave({
                outcome: "skipped",
                reason: offer === "never-connected" ? "the store's camera did not connect within 3 minutes" : "the photo check stopped part-way",
              })
            }
          />
          <Text style={s.small}>The advisor then checks the screen and body by eye.</Text>
        </>
      ) : null}
      <Big title="Wrong store? Use another code" kind="quiet" onPress={onWrongCode} />
      <Text style={s.small}>Trade-in {state.session.caseRef}</Text>
    </View>
  );
}

/** One full-screen pattern, as GradeIQ's /v2 draws it, with its small caption. */
function Pattern({ name }: { name: string }) {
  const [w, setW] = useState(0);
  const fill = PATTERN_FILLS[name];
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: fill ?? "#000" }]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <StatusBar hidden />
      {name === "stripes" && w > 0 ? (
        <View style={s.stripes}>
          {Array.from({ length: Math.ceil(w / STRIPE_PX) }, (_, i) => (
            <View key={i} style={{ width: STRIPE_PX, backgroundColor: i % 2 ? "#fff" : "#000" }} />
          ))}
        </View>
      ) : null}
      <View style={s.capWrap} pointerEvents="none">
        <Text style={s.cap}>
          📷 Screen check · showing <Text style={{ fontWeight: "900" }}>{name}</Text> — keep the phone still
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg, padding: 22, paddingTop: 30 },
  kicker: { color: T.accent, fontSize: 14, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 },
  title: { color: T.text, fontSize: 30, fontWeight: "800", lineHeight: 36, marginBottom: 10 },
  phone: { alignSelf: "center", width: 92, height: 150, borderRadius: 18, borderWidth: 3, borderColor: T.border, padding: 6, marginVertical: 22, transform: [{ perspective: 400 }, { rotateX: "45deg" }] },
  phoneScreen: { flex: 1, borderRadius: 12, backgroundColor: T.surface2 },
  status: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: T.radius, borderWidth: 1, backgroundColor: T.surface },
  dot: { width: 12, height: 12, borderRadius: 6 },
  statusText: { flex: 1, color: T.text, fontSize: 17, lineHeight: 24, fontWeight: "600" },
  privacy: { color: T.muted, fontSize: 14, lineHeight: 20, marginTop: 14 },
  small: { color: T.muted, fontSize: 14, textAlign: "center", marginTop: 8 },
  stripes: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row", overflow: "hidden" },
  capWrap: { position: "absolute", left: 0, right: 0, bottom: 32, alignItems: "center", paddingHorizontal: 24 },
  cap: { color: "#fff", backgroundColor: "rgba(0,0,0,0.75)", borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, fontSize: 13, fontWeight: "600", overflow: "hidden", textAlign: "center" },
});
