// SwapUp Check — the customer's app. Opened by the store's QR (deep link
// swapupcheck://join?code=…&server=…), it joins the store's session, asks the
// damage questions, runs the hardware tests, and streams every result to the
// store through the persistent outbox in ./engine.
//
// The same code runs in a browser at /app/check/ (the join page's "Test in this
// browser" link, and the only way to test an iPhone): there the code comes from
// ?code= in the page URL, progress lives in localStorage (./files.web.ts) and
// the device facts come from the browser (./deviceInfo.web.ts).
import "../shared/platform"; // browser shims (Alert, BackHandler) — a no-op on native
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, AppState, BackHandler, Linking, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { T } from "../shared/theme";
import { DEFAULT_SERVER, CLIENT_VERSION, IS_WEB } from "../shared/config";
import { CheckEngine, joinErrorMessage } from "./engine";
import { fileStore, storageIsPersistent } from "./files";
import { contractDevice } from "./deviceInfo";
import { parseJoinTarget, resumeStep } from "./core";
import { DoneScreen, EndedScreen, JoinScreen, QuestionsScreen, RunnerScreen, WelcomeScreen, supportedPlan } from "./screens";

export function CheckApp() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }} edges={["top", "left", "right", "bottom"]}>
        {IS_WEB && !storageIsPersistent() ? <NoStorageBar /> : null}
        <Root />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

/** Browser with storage blocked (private mode, blocked site data): a refresh would lose the place. */
function NoStorageBar() {
  return (
    <View style={{ paddingVertical: 10, paddingHorizontal: 16, backgroundColor: T.surface2, borderBottomWidth: 2, borderBottomColor: T.warn }}>
      <Text style={{ color: T.warn, fontSize: 14, lineHeight: 20, fontWeight: "600" }}>
        This browser isn't saving your progress (private browsing or blocked site data). Keep this page open until you finish — results
        already sent to the store are safe.
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

function Root() {
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

  // Tests the app cannot run here are reported as such — never silently missing.
  useEffect(() => {
    if (!state || state.ended || !state.consentAt) return;
    for (const p of unsupported) if (!state.results[p.id]) void engine.record(p.id, "unsupported", { reason: "not available in this app" });
  }, [engine, state, unsupported]);

  const step = state && !state.ended ? (rerun ? "runner" : resumeStep(state, runnable.map((p) => p.id))) : null;

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

  // On the Done screen, ask the store every few seconds whether it has applied the results.
  useEffect(() => {
    if (step !== "done") return;
    let t: ReturnType<typeof setTimeout>;
    let alive = true;
    const tick = async () => {
      const r = await engine.pollStatus();
      if (!alive || r?.status === "applied") return;
      t = setTimeout(tick, 4000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [engine, step]);

  // Android back: never drop out of a running test by accident (the runner has its own Pause).
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => step === "runner" && !paused);
    return () => sub.remove();
  }, [step, paused]);

  const finish = useCallback(() => {
    if (rerun) setRerun(null);
    void engine.finish();
  }, [engine, rerun]);

  if (!snap.ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: T.bg }}>
        <ActivityIndicator color={T.accent} size="large" />
      </View>
    );
  }

  if (state?.ended) return <EndedScreen message={state.ended} onNew={() => void engine.forget()} />;

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

  switch (step) {
    case "welcome":
      return <WelcomeScreen state={state} onConsent={() => void engine.consent()} onLeave={() => void engine.forget()} />;
    case "questions":
      return <QuestionsScreen initial={state.declared} onDone={(d) => void engine.declare(d)} />;
    case "runner":
      return (
        <RunnerScreen
          snap={snap}
          only={rerun}
          onResult={(id, outcome, detail) => void engine.record(id, outcome, detail)}
          onAllDone={finish}
          onQuit={() => setPaused(true)}
        />
      );
    case "done":
    default:
      return (
        <DoneScreen
          snap={snap}
          onRerun={(ids) => setRerun(ids)}
          onNewCheck={() => {
            setRerun(null);
            void engine.forget();
          }}
        />
      );
  }
}
