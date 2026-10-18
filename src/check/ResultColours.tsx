// The result screen ("Checks complete") can still be asked to show colours, full-screen,
// with the customer tapping nothing (owner, 2026-10-17: "the camera tests it; when it
// can't decide, the advisor certifies it with one tap, by name, while the customer's
// phone shows the colours"):
//
//   1. A camera page that comes back after the scan — a retake from the tablet, "Take
//      photos anyway", a Retry: GradeIQ's own patterns, echoed exactly like the scan
//      screen (GET/POST /api/device/screen), so its sweep can capture this screen.
//      Only news counts (../diagnostics/auto/pairing.ts followPoll). The screen says
//      "idle" when it opens — it can show the camera's colours again — and "off" when it
//      closes; during the tests the phone's last word is the scan screen's "off".
//   2. The advisor's check by eye in SwapUp Store ("Check the phone"): while GET
//      /api/device/status says `colours`, this phone loops white, black, red, green,
//      blue and stripes itself (colourAt) and tells the store it is doing so (phase
//      "colours"). Nothing is echoed to the camera: it isn't the camera's sweep.
//
// The camera wins when both want the screen. Brightness goes to full and the screen
// stays on while a colour is up (a browser can't set the brightness; it keeps the
// screen on with the Wake Lock API where there is one).
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Brightness from "expo-brightness";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { IS_WEB } from "../shared/config";
import {
  COLOUR_STEP_MS,
  ECHO_RESEND_MS,
  POLL_FAST_MS,
  SHOWN_OFF,
  colourAt,
  coloursOn,
  followPoll,
  newFollow,
  parseScreen,
  type Follow,
} from "../diagnostics/auto/pairing";
import { afterTwoFrames } from "./PairingScreen";
import type { CheckEngine, Snapshot } from "./engine";

/** How often the result screen looks for a camera page while none is driving it. */
const IDLE_POLL_MS = 2000;
const KEEP_AWAKE = "swapup-check-colours";

export const ADVISOR_CAPTION = "Advisor checking the screen — keep it face up";

export type ResultPattern = { name: string; caption?: string };

/**
 * What the result screen should draw instead of itself, or null. `active`: the result
 * screen is up and the check is still open (not applied, not ended).
 */
export function useResultColours(engine: CheckEngine, snap: Snapshot, active: boolean, onBleed: (on: boolean) => void): ResultPattern | null {
  const camera = useCameraFollow(engine, active);
  const advisor = useAdvisorColours(snap, active && camera === "idle");
  const pattern: ResultPattern | null = camera !== "idle" ? { name: camera } : advisor ? { name: advisor, caption: ADVISOR_CAPTION } : null;
  const up = !!pattern;

  // Where the phone is, for the store: "colours" while the advisor's loop is up.
  useEffect(() => {
    if (!active) return;
    engine.reportPhase(advisor && camera === "idle" ? "colours" : "done");
  }, [engine, active, advisor, camera]);

  // Full-bleed, full brightness and the screen kept on while a colour is up.
  const bleed = useRef(onBleed);
  bleed.current = onBleed;
  useEffect(() => {
    if (!up) return;
    bleed.current(true);
    activateKeepAwakeAsync(KEEP_AWAKE).catch(() => {});
    let prev: number | null = null;
    if (!IS_WEB)
      Brightness.getBrightnessAsync()
        .then((b) => {
          prev = b;
          return Brightness.setBrightnessAsync(1);
        })
        .catch(() => {});
    return () => {
      bleed.current(false);
      deactivateKeepAwake(KEEP_AWAKE).catch(() => {});
      if (!IS_WEB) {
        if (Platform.OS === "android") Brightness.restoreSystemBrightnessAsync().catch(() => {});
        else if (prev != null) Brightness.setBrightnessAsync(prev).catch(() => {});
      }
    };
  }, [up]);

  return pattern;
}

/** 1. A camera page after the scan: GradeIQ's pattern to draw ("idle" = none). */
function useCameraFollow(engine: CheckEngine, active: boolean): string {
  const [draw, setDraw] = useState("idle");
  const drawRef = useRef("idle");
  const lastEcho = useRef<{ shown: string; at: number } | null>(null);
  const live = useRef(false);

  // The echo, two frames after a colour lands — only while a camera page drives this screen.
  useEffect(() => {
    drawRef.current = draw;
    if (!live.current) return;
    return afterTwoFrames(() => {
      lastEcho.current = { shown: draw, at: Date.now() };
      void engine.screenShown(draw);
    });
  }, [engine, draw]);

  useEffect(() => {
    if (!active) {
      setDraw("idle");
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let f: Follow = newFollow(Date.now());
    let refusals = 0;
    // Back where a camera page can drive it: say so (nothing is drawn yet).
    lastEcho.current = { shown: "idle", at: Date.now() };
    void engine.screenShown("idle");
    const tick = async () => {
      const started = Date.now();
      const r = await engine.screenPoll();
      if (!alive) return;
      const now = Date.now();
      let wait = IDLE_POLL_MS;
      if (r.ok) {
        refusals = 0;
        const p = parseScreen(r.body);
        if (p) {
          const wasLive = live.current;
          const next = followPoll(f, p, now);
          f = next.follow;
          live.current = f.live;
          if (p.state === "disabled" || p.state === "failed") return setDraw("idle"); // no camera for this check: stop looking
          if (wasLive && !f.live) void engine.screenShown(SHOWN_OFF); // the camera page has gone
          if (next.draw !== drawRef.current) setDraw(next.draw);
          else if (f.live && p.shown !== next.draw && (!lastEcho.current || now - lastEcho.current.at > ECHO_RESEND_MS)) {
            lastEcho.current = { shown: next.draw, at: now };
            void engine.screenShown(next.draw);
          }
          if (f.live) wait = POLL_FAST_MS;
        }
      } else if (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 403 && r.status !== 429) {
        // An older server, or no camera for this check: a few refusals and the result screen stops asking.
        if (++refusals >= 3) return setDraw("idle");
      }
      timer = setTimeout(tick, Math.max(0, wait - (Date.now() - started)));
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
      // Gone from the result screen (applied, a new check): no camera may take an old echo for an answer.
      void engine.screenShown(SHOWN_OFF);
      live.current = false;
    };
  }, [engine, active]);

  return active ? draw : "idle";
}

/** 2. The advisor's check by eye: the colour to show now, or null. */
function useAdvisorColours(snap: Snapshot, allowed: boolean): string | null {
  const remote = snap.remote;
  const want = allowed && remote?.colours === true;
  // When the store last said "show them" (each status read is a new object): a status that
  // stops coming — Wi‑Fi gone, the store app closed — stops the loop on its own.
  const saidAt = useRef<number | null>(null);
  useEffect(() => {
    saidAt.current = remote?.colours === true ? Date.now() : null;
  }, [remote]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!want) {
      setStartedAt(null);
      return;
    }
    setStartedAt((s) => s ?? Date.now());
    const t = setInterval(() => tick((n) => n + 1), COLOUR_STEP_MS / 5);
    return () => clearInterval(t);
  }, [want]);
  // The first render after the store says so has no stamp yet: the next tick (⅕ of a colour) has.
  if (!want || startedAt == null || !coloursOn(saidAt.current, Date.now())) return null;
  return colourAt(startedAt, Date.now());
}
