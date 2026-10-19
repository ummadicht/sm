// SwapUp Check — the customer's app. Opened by the store's QR (deep link
// swapupcheck://join?code=…&server=…) or the store's counter code, it joins the
// store's session and streams every result to the store through the persistent
// outbox in ./engine.
//
// The phone leads, in three steps (owner, 2026-10-17: "Reduce the flow"): Scan › Test › Done.
// Native (the APK): the Scan QR for the advisor's tablet (the camera photographs the phone and
// sweeps its screen, one pass) — "Is this your phone?" first only when the store couldn't name
// it exactly — then the battery screenshot (only when the store has no other reading of it;
// skippable), then every test runs by itself (./NativeCheck.tsx, docs/AUTO-TESTS.md), then Done.
//
// The same code runs in a browser at /app/check/ (the join page's "Test in this
// browser" link, and the only way to test an iPhone): welcome (consent), then the same
// Identify (a phone not named exactly only), Scan (no brightness control there) and
// battery steps, then the guided tests (./screens.tsx). No damage questions and no
// "was the screen clean?": the camera checks the condition, and the advisor
// certifies what it couldn't while this screen shows the colours. There the
// code comes from ?code= in the page URL, progress lives in localStorage
// (./files.web.ts) and the device facts come from the browser (./deviceInfo.web.ts).
import "../shared/platform"; // browser shims (Alert, BackHandler) — a no-op on native
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, AppState, BackHandler, Linking, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { P } from "../shared/theme";
import { DEFAULT_SERVER, CLIENT_VERSION, IS_WEB } from "../shared/config";
import { APPLIED_MESSAGE, CheckEngine, joinErrorMessage } from "./engine";
import { fileStore, storageIsPersistent } from "./files";
import { contractDevice } from "./deviceInfo";
import { displayAfterScan, parseJoinTarget, phaseFor, resumeStep, type BatteryRec, type PairingRec } from "./core";
import { EndedScreen, JoinScreen, RunnerScreen, WelcomeScreen, supportedPlan } from "./screens";
import { NativeCheck } from "./NativeCheck";
import { ResultScreen } from "./ResultScreen";
import { IdentifyScreen } from "./IdentifyScreen";
import { Pattern, PairingScreen } from "./PairingScreen";
import { useResultColours } from "./ResultColours";
import { BatteryScreen } from "./BatteryScreen";
import { Railed } from "./StepRail";
import { donePollMs } from "./report";

const EDGES = ["top", "left", "right", "bottom"] as const;
/** A check that ended applied offers no re-run. */
const NO_REDO = { ids: [], names: [] };

export function CheckApp() {
  // Native pairing only: a screen pattern for the store's camera fills the whole
  // display (no safe-area padding, no status bar). Never set in the browser.
  const [bleed, setBleed] = useState(false);
  return (
    <SafeAreaProvider>
      {/* Light theme: dark status-bar icons on the grey tint. */}
      <StatusBar style="dark" hidden={bleed} />
      <SafeAreaView style={{ flex: 1, backgroundColor: P.bg }} edges={bleed ? [] : EDGES}>
        {/* Not over a screen-check pattern: the camera needs the whole screen lit. */}
        {IS_WEB && !bleed && !storageIsPersistent() ? <NoStorageBar /> : null}
        <Root onBleed={setBleed} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

/** Browser with storage blocked (private mode, blocked site data): a refresh would lose the place. */
function NoStorageBar() {
  return (
    <View style={{ paddingVertical: 10, paddingHorizontal: 20, backgroundColor: P.warnBg }}>
      <Text style={{ color: "#8A4B00", fontSize: 14, lineHeight: 20, fontWeight: "600" }}>
        Progress isn't saved here — keep this page open.
      </Text>
    </View>
  );
}

const KEEP_AWAKE = "swapup-check";

/**
 * Browser: the API is this page's own origin (same-origin hosting — no CORS).
 * A server named in a link or QR that is on another origin could not be called
 * from here anyway, so the page's own server is used instead.
 */
function serverFor(server: string | null): string {
  const s = (server || DEFAULT_SERVER).replace(/\/$/, "");
  if (!IS_WEB) return s;
  try {
    return new URL(s).origin === window.location.origin ? s : DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
}

/** Browser: drop ?code= / ?server= once joined, so a refresh resumes from storage instead of re-joining. */
function cleanJoinUrl() {
  if (!IS_WEB || typeof window === "undefined") return;
  try {
    const u = new URL(window.location.href);
    if (!u.searchParams.has("code") && !u.searchParams.has("server")) return;
    u.searchParams.delete("code");
    u.searchParams.delete("server");
    window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
  } catch {
    /* cosmetic */
  }
}

function Root({ onBleed }: { onBleed: (on: boolean) => void }) {
  const engine = useMemo(() => new CheckEngine(fileStore, contractDevice, { appVersion: CLIENT_VERSION }), []);
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<string | undefined>(undefined);
  // null = normal run; a list = re-running just those tests from the Done screen.
  const [rerun, setRerun] = useState<string[] | null>(null);
  const [paused, setPaused] = useState(false);
  const pendingLink = useRef<string | null>(null);
  // The quiet re-join of the saved check. A link to a DIFFERENT code must wait for
  // it: a late answer about the old session would otherwise land on the new one
  // (end it, or overwrite it with the old session).
  const refreshing = useRef<Promise<void>>(Promise.resolve());
  const refresh = useCallback(() => {
    const p = refreshing.current
      .then(() => engine.refreshTicket())
      .then(() => engine.flush())
      .catch(() => {});
    refreshing.current = p;
    return p;
  }, [engine]);

  // ── boot: load what's on disk, start the retry loop, re-join quietly
  useEffect(() => {
    let alive = true;
    (async () => {
      await engine.init();
      if (!alive) return;
      engine.start();
      // Opened with a link to another code (the browser always is, via ?code=):
      // don't bother re-joining the old check — the link replaces it.
      const link = pendingLink.current ? parseJoinTarget(pendingLink.current) : null;
      const cur = engine.getSnapshot().state;
      const replacing = !!link && link.kind === "join" && !!cur && !cur.ended && cur.code !== link.code;
      if (!replacing) void refresh();
      if (pendingLink.current) void handleLink(pendingLink.current);
    })();
    return () => {
      alive = false;
      engine.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  // ── join (from a deep link, a scanned QR, or a typed code)
  const join = useCallback(
    async (code: string, server: string | null) => {
      setJoinError(null);
      setJoining(true);
      try {
        const r = await engine.join(code, serverFor(server));
        if (!r.ok) setJoinError(joinErrorMessage(r.status, r.message));
        else {
          setRerun(null);
          setPaused(false);
          cleanJoinUrl();
        }
      } finally {
        setJoining(false);
      }
    },
    [engine]
  );

  const handleLink = useCallback(
    async (url: string) => {
      const t = parseJoinTarget(url);
      if (!t || t.kind !== "join") return;
      if (!engine.getSnapshot().ready) {
        pendingLink.current = url;
        return;
      }
      pendingLink.current = null;
      const cur = engine.getSnapshot().state;
      // The same code again (app reopened from the browser / page refreshed) — just carry on.
      if (cur && !cur.ended && cur.code === t.code) {
        cleanJoinUrl();
        return;
      }
      setLinkCode(t.code);
      await refreshing.current;
      const now = engine.getSnapshot().state;
      if (now && !now.ended && now.code === t.code) {
        cleanJoinUrl();
        return;
      }
      if (now && !now.ended) await engine.forget();
      await join(t.code, t.server);
    },
    [engine, join]
  );

  useEffect(() => {
    if (IS_WEB) {
      // The join page links here as /app/check/?code=K7M2QX. There are no deep
      // links in a browser; the page URL is the link.
      if (typeof window !== "undefined") void handleLink(window.location.href);
      return;
    }
    Linking.getInitialURL()
      .then((u) => {
        if (u) void handleLink(u);
      })
      .catch(() => {});
    const sub = Linking.addEventListener("url", (e) => handleLink(e.url));
    return () => sub.remove();
  }, [handleLink]);

  // ── resume: send anything queued and re-check the ticket when the app comes back
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const state = snap.state;
  const plan = state?.session.plan ?? [];
  const { runnable, unsupported } = useMemo(() => supportedPlan(plan), [plan]);

  // The browser flow's step. Native has its own (NativeCheck): null here keeps the
  // effects below (keep-awake, finish, status polling, back button) browser-only.
  const step = IS_WEB && state && !state.ended ? (rerun ? "runner" : resumeStep(state, runnable.map((p) => p.id))) : null;

  // Tests the app cannot run here are reported as such — never silently missing.
  // Only once the tests are reached (Identify, Scan and the battery step come
  // first). Browser flow; the native flow does its own bookkeeping in NativeCheck.
  const testing = step === "runner" || step === "done";
  useEffect(() => {
    if (!IS_WEB || !state || state.ended || !state.consentAt || !testing) return;
    for (const p of unsupported) if (!state.results[p.id]) void engine.record(p.id, "unsupported", { reason: "not available in this app" });
  }, [engine, state, unsupported, testing]);

  // Where the phone is, for the store's tablet (browser flow; native reports its own).
  useEffect(() => {
    if (step && !paused) engine.reportPhase(phaseFor(step));
  }, [engine, step, paused]);

  // Keep the screen on while testing.
  useEffect(() => {
    if (step === "runner" && !paused) {
      activateKeepAwakeAsync(KEEP_AWAKE).catch(() => {});
      return () => {
        deactivateKeepAwake(KEEP_AWAKE).catch(() => {});
      };
    }
  }, [step, paused]);

  // Reaching the Done screen means every runnable test has a result — tell the
  // store "complete" once (a re-run bumps it again inside engine.record).
  useEffect(() => {
    if (step === "done" && state && !state.completeAt) void engine.finish();
  }, [engine, step, state]);

  // On the result screen, ask the store every few seconds whether it has applied the results —
  // every 1.5 s while the advisor is checking the screen by eye — and then for the answer until it
  // is final (./report.ts donePollMs).
  useEffect(() => {
    if (step !== "done") return;
    let t: ReturnType<typeof setTimeout>;
    let alive = true;
    const tick = async () => {
      const r = await engine.pollStatus();
      // Ended (cancelled, expired): nothing more to read. Applied: every 5 s while the answer can
      // still change, never again once it is final; slowly from an older server (no answer).
      if (!alive || engine.getSnapshot().state?.ended) return;
      const ms = donePollMs(r);
      if (ms !== null) t = setTimeout(tick, ms);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [engine, step]);

  // Ended because the store applied the results (native and browser alike): read the status now
  // when it isn't in memory (the app was restarted on that screen), then again on the same clock as
  // the live screen — every 5 s while the answer can still change, stopping once it is final.
  const endedApplied = state?.ended === APPLIED_MESSAGE;
  const haveRemote = !!snap.remote;
  useEffect(() => {
    if (endedApplied && !haveRemote) void engine.readAppliedStatus();
  }, [engine, endedApplied, haveRemote]);
  useEffect(() => {
    if (!endedApplied) return;
    let t: ReturnType<typeof setTimeout>;
    let alive = true;
    const next = () => {
      const ms = donePollMs(engine.getSnapshot().remote);
      if (ms !== null) t = setTimeout(tick, ms);
    };
    const tick = async () => {
      await engine.readAppliedStatus({ again: true });
      if (alive) next();
    };
    next();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [engine, endedApplied]);

  // Android back: never drop out of a running test by accident (the runner has its own Pause).
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => step === "runner" && !paused);
    return () => sub.remove();
  }, [step, paused]);

  const finish = useCallback(() => {
    if (rerun) setRerun(null);
    void engine.finish();
  }, [engine, rerun]);

  // The browser's scan is over: as natively, `display` is "not tested" with the reason when
  // the camera didn't run — the camera's sweep or the advisor's certification decide it.
  const scanDone = useCallback(
    async (r: Omit<PairingRec, "at">) => {
      await engine.setPairing({ ...r, at: new Date().toISOString() });
      const cur = engine.getSnapshot().state;
      const d = cur ? displayAfterScan(r, cur.session.plan.map((p) => p.id), cur.results) : null;
      if (d) await engine.record("display", "skip", d);
    },
    [engine]
  );

  // The result screen's colours (browser): a camera page that comes back, or the advisor's check by eye.
  const colours = useResultColours(engine, snap, IS_WEB && step === "done" && !paused && snap.remote?.status !== "applied", onBleed);

  if (!snap.ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: P.bg }}>
        <ActivityIndicator color={P.primary} size="large" />
      </View>
    );
  }

  if (state?.ended) {
    // Applied is a finish: the same result screen as when it happens live, native or browser (it
    // reads the answer and the report link from snap.remote once readAppliedStatus has it).
    // Anything else ended the check.
    if (state.ended === APPLIED_MESSAGE) {
      return (
        <Railed at="done">
          <ResultScreen snap={snap} redo={NO_REDO} onRerun={() => {}} onNewCheck={() => void engine.forget()} />
        </Railed>
      );
    }
    return <EndedScreen message={state.ended} onNew={() => void engine.forget()} />;
  }

  if (!state || paused) {
    if (state && paused) {
      // Paused mid-run: one tap to carry on.
      return (
        <WelcomeScreen
          state={state}
          onConsent={() => setPaused(false)}
          onLeave={() => {
            setPaused(false);
            void engine.forget();
          }}
        />
      );
    }
    return <JoinScreen busy={joining} error={joinError} initialCode={linkCode} onJoin={(c, s) => void join(c, s)} />;
  }

  if (!IS_WEB) {
    return (
      <NativeCheck
        key={state.session.id}
        engine={engine}
        snap={snap}
        onBleed={onBleed}
        onWrongCode={() => {
          onBleed(false);
          void engine.forget();
        }}
        onNewCheck={() => void engine.forget()}
      />
    );
  }

  switch (step) {
    case "welcome":
      return (
        <Railed at="scan">
          <WelcomeScreen state={state} onConsent={() => void engine.consent()} onLeave={() => void engine.forget()} />
        </Railed>
      );
    case "identify":
      return (
        <Railed at="scan">
          <IdentifyScreen engine={engine} state={state} onDone={(a) => void engine.identify(a)} onWrongCode={() => void engine.forget()} />
        </Railed>
      );
    case "scan":
      // A browser shows the camera's patterns too (it can't set the brightness; it says so).
      return <PairingScreen key={state.session.id} engine={engine} state={state} onBleed={onBleed} onDone={(r: Omit<PairingRec, "at">) => void scanDone(r)} />;
    case "battery":
      return (
        <Railed at="test">
          <BatteryScreen engine={engine} state={state} onDone={(b: Omit<BatteryRec, "at">) => void engine.setBattery({ ...b, at: new Date().toISOString() })} />
        </Railed>
      );
    case "runner":
      return (
        <Railed at="test">
          <RunnerScreen
            snap={snap}
            only={rerun}
            onResult={(id, outcome, detail) => void engine.record(id, outcome, detail)}
            onAllDone={finish}
            onQuit={() => setPaused(true)}
          />
        </Railed>
      );
    case "done":
    default: {
      if (colours) return <Pattern name={colours.name} caption={colours.caption} />;
      const redo = runnable.filter((p) => {
        const o = state.results[p.id]?.outcome;
        return o === "fail" || o === "skip";
      });
      return (
        <Railed at="done">
          <ResultScreen
            snap={snap}
            redo={{ ids: redo.map((p) => p.id), names: redo.map((p) => p.name) }}
            onRerun={(ids) => setRerun(ids)}
            onNewCheck={() => {
              setRerun(null);
              void engine.forget();
            }}
          />
        </Railed>
      );
    }
  }
}
