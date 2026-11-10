// SwapUp Check, Scan — the step after Identify since the phone-led flow (swapup
// docs/PHONE-LED-FLOW.md §3, app ≥ 0.6.0; before that it was the last step). The
// phone shows a big QR of GradeIQ's camera link (GET /api/device/camera-link —
// GradeIQ v2's own await2nd screen, V2Flow.tsx 810-837); the advisor's tablet
// scans it and opens GradeIQ's camera page, which photographs this phone and
// asks this screen for patterns (white, black, stripes, colours…) through
// SwapUp's /api/device/screen. This phone draws each one full-screen and echoes
// what it is ACTUALLY drawing (V2Flow.tsx 236-275, 794-808). At the end the
// camera may want a photo of Settings › About phone — this screen asks the
// customer to open it. Pure decisions: ../diagnostics/auto/pairing.ts.
//
// The customer is never asked to skip it (owner, 2026-10-17): the phone stays here
// until the camera finishes, camera grading is off for this check, or the advisor
// taps "Continue without camera" in SwapUp Store (the server's `released`). Only an
// older server — one that never sends `released` — still gets the 90 s "Skip the
// camera check" (pairing.ts skipOffer).
//
// The handshake is tuned to GradeIQ's sweep, which waits a few seconds for the echo
// of each colour: the echo goes out two frames after the colour is drawn, a lost one
// is re-sent after 600 ms, /screen is polled every 350 ms once the camera page is
// here, and leaving says "off" — so a phone that has gone can never answer "white".
//
// Runs in the browser build too: a web page can't set the brightness (it says
// so) and keeps the screen on with the Wake Lock API where there is one.
//
// It comes before the permission dialogs (GetReady runs after it), so no dialog
// can cover a pattern mid-sweep.
//
// Look: the idle screen is the SWAPUP EXPERIENCE CENTER kit — the QR on a white
// rounded card is the hero. The patterns are functional, not styled: they stay
// exactly as GradeIQ's /v2 draws them.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, Vibration, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Brightness from "expo-brightness";
import * as Haptics from "expo-haptics";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { P } from "../shared/theme";
import { IS_WEB } from "../shared/config";
import { QR } from "../shared/QR";
import { Caption, Headline, Hero, Lead, Notice, PhoneImeiArt, PillButton, ScanArt, Screen, StatusLine } from "../shared/kit";
import {
  ECHO_RESEND_MS,
  PATTERN_FILLS,
  SHOWN_OFF,
  STRIPE_PX,
  displayablePattern,
  freshNews,
  needsEcho,
  newTracker,
  parseCameraLink,
  parseScreen,
  pollEvery,
  settingsPrompt,
  skipOffer,
  trackPoll,
  trackRefusal,
  type ScreenPoll,
  type Tracker,
} from "../diagnostics/auto/pairing";
import { StepRail } from "./StepRail";
import type { CheckEngine } from "./engine";
import { onIphone } from "./onIphone";
import type { CheckState, PairingRec } from "./core";

const LOCK_TONE = require("../../assets/tones/beep1.wav");

/**
 * Short, pleasant haptic and two-note chime when the store's camera locks onto
 * this screen's QR code and connects. Best-effort: never blocks or throws.
 */
function triggerQrLockFeedback(): void {
  if (IS_WEB) {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate([30, 40, 50]);
      }
    } catch {
      /* vibration blocked or unsupported */
    }
    try {
      const g = globalThis as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const Ctx = g.AudioContext ?? g.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const t0 = ctx.currentTime;
      const playNote = (freq: number, start: number, dur: number, peak: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(peak, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur + 0.01);
      };
      // Ascending D5 → A5 fifth chime (~170 ms total)
      playNote(587.33, t0, 0.075, 0.14);
      playNote(880.0, t0 + 0.065, 0.11, 0.16);
      setTimeout(() => {
        void ctx.close().catch(() => {});
      }, 300);
    } catch {
      /* Web Audio blocked by autoplay policy */
    }
    return;
  }

  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {
    try {
      Vibration.vibrate(40);
    } catch {
      /* no vibration hardware */
    }
  });

  void (async () => {
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      const player = createAudioPlayer(LOCK_TONE);
      player.volume = 0.5;
      player.play();
      setTimeout(() => {
        try {
          player.pause();
          player.release();
        } catch {
          /* already released */
        }
      }, 700);
    } catch {
      /* audio unavailable */
    }
  })();
}

type Props = {
  engine: CheckEngine;
  state: CheckState;
  onDone: (rec: Omit<PairingRec, "at">) => void;
  /** Full-bleed while a pattern is up (the app drops its safe-area padding and hides the status bar). */
  onBleed: (on: boolean) => void;
};

const KEEP_AWAKE = "swapup-check-scan";

/** ready = a QR to show; none = no QR (an older server, or not a link we can draw) — the advisor opens the camera from the tablet. */
type LinkState = { kind: "loading" } | { kind: "ready"; url: string } | { kind: "none" };

export function PairingScreen({ engine, state, onDone, onBleed }: Props) {
  const [ready, setReady] = useState(false);
  const [drawing, setDrawing] = useState("idle");
  const [poll, setPoll] = useState<ScreenPoll | null>(null);
  /** offline = no network answer; busy = the server answered 5xx/429 (e.g. it can't reach GradeIQ just now). */
  const [trouble, setTrouble] = useState<null | "offline" | "busy">(null);
  const [offer, setOffer] = useState<ReturnType<typeof skipOffer>>(null);
  const [link, setLink] = useState<LinkState>({ kind: "loading" });
  /** The camera has finished the sweep and is waiting for a photo of Settings. */
  const [askSettings, setAskSettings] = useState(false);
  const [settingsNote, setSettingsNote] = useState<string | null>(null);
  const tracker = useRef<Tracker>(newTracker(Date.now()));
  const lockFeedbackFired = useRef(false);
  const drawingRef = useRef("idle");
  const lastEcho = useRef<{ shown: string; at: number } | null>(null);
  const left = useRef(false);
  const cbs = useRef({ onDone, onBleed });
  cbs.current = { onDone, onBleed };
  const { width } = useWindowDimensions();
  const [ios] = useState(onIphone);

  const leave = useCallback(
    (rec: Omit<PairingRec, "at">) => {
      if (left.current) return;
      left.current = true;
      // Not a colour: a camera page still waiting for "white" must never take this phone's
      // last echo for an answer once it has gone (GradeIQ keeps the last `shown`).
      void engine.screenShown(SHOWN_OFF);
      cbs.current.onBleed(false);
      cbs.current.onDone(rec);
    },
    [engine]
  );

  // Max brightness for the camera; the phone's own setting comes back afterwards.
  // (A browser can't do this — the idle screen asks the customer instead.)
  useEffect(() => {
    let prev: number | null = null;
    if (!IS_WEB) {
      Brightness.getBrightnessAsync()
        .then((b) => {
          prev = b;
          return Brightness.setBrightnessAsync(1);
        })
        .catch(() => {});
    }
    return () => {
      if (!IS_WEB) {
        if (Platform.OS === "android") Brightness.restoreSystemBrightnessAsync().catch(() => {});
        else if (prev != null) Brightness.setBrightnessAsync(prev).catch(() => {});
      }
      cbs.current.onBleed(false);
    };
  }, []);

  // The screen must not sleep while the advisor is walking over (browser: Wake Lock, where there is one).
  useEffect(() => {
    activateKeepAwakeAsync(KEEP_AWAKE).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE).catch(() => {});
    };
  }, []);

  useEffect(() => {
    tracker.current = newTracker(Date.now());
    lockFeedbackFired.current = false;
    setReady(true);
  }, []);

  // The QR: GradeIQ's camera link. 409 = GradeIQ's session isn't ready yet, so
  // ask again shortly; a network or server hiccup the same, more slowly; 404 = a
  // server without the route (older) — no QR, the advisor uses the tablet's button.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const ask = async () => {
      const r = await engine.cameraLink();
      if (!alive) return;
      if (r.ok) {
        const url = parseCameraLink(r.body);
        setLink(url ? { kind: "ready", url } : { kind: "none" });
        return;
      }
      const again = r.status === 409 || r.status === 0 || r.status === 401 || r.status === 403 || r.status === 429 || r.status >= 500;
      if (!again) {
        setLink({ kind: "none" });
        return;
      }
      timer = setTimeout(ask, r.status === 409 ? 2500 : 5000);
    };
    void ask();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [engine]);

  const echo = useCallback(
    (shown: string) => {
      if (left.current) return;
      lastEcho.current = { shown, at: Date.now() };
      void engine.screenShown(shown);
    },
    [engine]
  );

  // Echo what is on screen once it has been drawn: two frames after the colour lands.
  useEffect(() => {
    if (!ready) return;
    drawingRef.current = drawing;
    cbs.current.onBleed(drawing !== "idle");
    return afterTwoFrames(() => echo(drawing));
  }, [drawing, ready, echo]);

  // Poll ~700 ms, ~350 ms once the camera page is here (setTimeout chain: a slow answer never overlaps the next request).
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
          setTrouble(null);
          const wasConnected = tracker.current.connectedAt != null;
          const t = trackPoll(tracker.current, p, now);
          tracker.current = t.tracker;
          if (!wasConnected && t.tracker.connectedAt != null && !lockFeedbackFired.current) {
            lockFeedbackFired.current = true;
            triggerQrLockFeedback();
          }
          setPoll(p);
          if (t.leave === "disabled") return leave({ outcome: "unavailable", reason: "camera grading is switched off for this store" });
          if (t.leave === "failed") return leave({ outcome: "unavailable", reason: "camera grading could not start for this check" });
          if (t.leave === "released") return leave({ outcome: "skipped", reason: "the advisor went on without the camera" });
          if (t.leave === "alone") return leave({ outcome: "skipped", reason: "the store's camera didn't connect" });
          if (t.leave) return leave({ outcome: t.leave, reason: null });
          const want = displayablePattern(p.pattern);
          if (want !== drawingRef.current) setDrawing(want);
          else if (needsEcho(p, want) && (!lastEcho.current || now - lastEcho.current.at > ECHO_RESEND_MS)) echo(want);
          setAskSettings(settingsPrompt(t.tracker, p, now));
        }
      } else if (r.status === 0) {
        setTrouble("offline");
      } else if (r.status >= 500 || r.status === 429) {
        setTrouble("busy");
      } else if (r.status !== 401 && r.status !== 403) {
        // The server said no (no camera grading for this check, or an older server without the route).
        const t = trackRefusal(tracker.current, now);
        tracker.current = t.tracker;
        if (t.unavailable) return leave({ outcome: "unavailable", reason: r.message || `the store's system refused the camera check (${r.status})` });
      }
      setOffer(skipOffer(tracker.current, now, drawingRef.current !== "idle"));
      timer = setTimeout(tick, Math.max(0, pollEvery(tracker.current) - (Date.now() - started)));
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [ready, engine, echo, leave]);

  // An older server only (no `released`): the customer's own way out, as before.
  const skip = (why: "never-connected" | "stalled") =>
    leave({
      outcome: "skipped",
      reason: why === "never-connected" ? "the store's camera page did not open within 90 seconds" : "the camera check stopped part-way",
    });

  const openAbout = async () => {
    setSettingsNote(null);
    try {
      await Linking.sendIntent("android.settings.DEVICE_INFO_SETTINGS");
    } catch {
      try {
        await Linking.sendIntent("android.settings.SETTINGS");
      } catch {
        setSettingsNote("Open Settings from your home screen.");
      }
    }
  };

  // A pattern fills the screen — but never traps the customer: if the camera has
  // gone quiet (stalled), the way out is drawn over the pattern too.
  if (ready && drawing !== "idle")
    return (
      <Pattern name={drawing}>
        {offer ? (
          <View style={s.overOffer}>
            <PillButton title="Skip camera" kind="outline" arrow={false} onPress={() => skip("stalled")} style={{ backgroundColor: P.surface }} />
          </View>
        ) : null}
      </Pattern>
    );

  const connected = tracker.current.connectedAt != null;
  const released = !!tracker.current.releaseKnown;
  // Only what the camera said since this screen mounted: photos taken before the
  // phone joined (an older store flow) leave cosmeticDone + "ok" behind, which say nothing about now.
  const news = poll ? freshNews(tracker.current, poll) : null;
  const retake = news?.capture?.verdict === "retake" || news?.capture?.verdict === "retaking";
  const statusLine = (() => {
    if (!ready) return "One moment…";
    if (trouble === "offline") return "Waiting for Wi‑Fi…";
    if (trouble === "busy" || poll?.unreachable) return "Store busy — this carries on by itself.";
    if (poll?.state === "pending") return "Getting ready…";
    if (askSettings) return "Waiting for the Settings photo.";
    if (news?.cosmeticDone) return "Photos accepted — finishing…";
    if (retake) return "Retaking the photos.";
    if (connected) return "Connected — face the camera.";
    return released ? "Moving on by itself…" : "Waiting for the advisor's tablet…";
  })();
  const qrSize = Math.max(180, Math.min(280, width - P.gutter * 2 - 40));

  return (
    <View style={{ flex: 1, backgroundColor: P.bg }}>
      <StepRail at="scan" />
      <Screen
        footer={
          <>
            {askSettings && Platform.OS === "android" ? <PillButton title="Open Settings" onPress={() => void openAbout()} /> : null}
            {offer ? (
              <>
                <PillButton title="Skip camera" kind="outline" arrow={false} onPress={() => skip(offer)} />
                <Caption style={{ marginTop: 0 }}>The advisor checks it by eye.</Caption>
              </>
            ) : null}
            <Caption style={{ marginTop: 0 }}>Trade-in {state.session.caseRef}</Caption>
          </>
        }
      >
        {askSettings ? (
          <>
            <Headline>{ios ? "Open Settings › General › About" : "Open Settings › About phone"}</Headline>
            <Lead>For the model and IMEI — then come back.</Lead>
            <Hero>
              <PhoneImeiArt width={104} />
            </Hero>
            {settingsNote ? <Notice tone="warn">{settingsNote}</Notice> : null}
          </>
        ) : (
          <>
            <Headline>{connected ? "Face the advisor's camera" : "Show this to the advisor"}</Headline>
            <Lead>{connected ? "It takes the photos by itself." : "Their tablet scans it — about 2 minutes."}</Lead>
            <Hero minHeight={qrSize + 60}>
              {/* Once the camera page is connected the code is gone: the front-glass photo must never carry it. */}
              {connected ? (
                <>
                  <ScanArt width={220} />
                  <Notice style={{ marginTop: 18, alignSelf: "stretch" }}>Keep this screen facing the advisor's camera.</Notice>
                </>
              ) : link.kind === "ready" ? (
                <View style={s.qrCard}>
                  <QR value={link.url} size={qrSize} fallback="No QR — the advisor opens the camera instead." />
                </View>
              ) : link.kind === "loading" ? (
                <View style={[s.qrCard, { width: qrSize + 40, height: qrSize + 40, alignItems: "center", justifyContent: "center" }]}>
                  <ActivityIndicator color={P.primary} size="large" />
                  <Caption>Getting the scan code…</Caption>
                </View>
              ) : (
                <>
                  <ScanArt width={220} />
                  <Notice style={{ marginTop: 18, alignSelf: "stretch" }}>Keep this screen facing the advisor's camera.</Notice>
                </>
              )}
            </Hero>
            {IS_WEB ? <Notice tone="warn">Turn brightness all the way up.</Notice> : null}
          </>
        )}
        <StatusLine text={statusLine} tone={trouble ? "warn" : connected ? "pass" : "muted"} style={{ marginTop: 18 }} />
      </Screen>
    </View>
  );
}

/**
 * Run `fn` once the frame drawn now and the next one are on screen (a pattern needs a
 * frame or two to land before the camera can trust the echo). Returns a cancel. Falls
 * back to a short timer where there is no requestAnimationFrame.
 */
export function afterTwoFrames(fn: () => void): () => void {
  const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame;
  const caf = (globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame;
  if (typeof raf !== "function") {
    const t = setTimeout(fn, 50);
    return () => clearTimeout(t);
  }
  let alive = true;
  let id = raf(() => {
    id = raf(() => {
      if (alive) fn();
    });
  });
  return () => {
    alive = false;
    caf?.(id);
  };
}

/** One full-screen pattern, as GradeIQ's /v2 draws it, with its small caption (`caption` replaces the camera's). */
export function Pattern({ name, caption, children }: { name: string; caption?: string; children?: React.ReactNode }) {
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
        {caption ? (
          <Text style={s.cap}>{caption}</Text>
        ) : (
          <Text style={s.cap}>
            📷 Screen check · <Text style={{ fontWeight: "900" }}>{name}</Text> — keep still
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  // White all round: the quiet zone the tablet's camera needs.
  qrCard: { padding: 20, borderRadius: P.radius, backgroundColor: P.surface },
  stripes: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row", overflow: "hidden" },
  overOffer: { position: "absolute", top: 48, left: 24, right: 24 },
  capWrap: { position: "absolute", left: 0, right: 0, bottom: 32, alignItems: "center", paddingHorizontal: 24 },
  cap: { color: "#fff", backgroundColor: "rgba(0,0,0,0.75)", borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, fontSize: 13, fontWeight: "600", overflow: "hidden", textAlign: "center" },
});
