// SwapUp Store — the staff app at the service-centre counter.
//
// Navigation is a small state machine (no router): boot → sign in → home ⇄
// new trade-in / session / settings / web desk. The staff token lives in the
// OS keystore (expo-secure-store) and is checked against GET /api/me on launch;
// any 401 anywhere sends the app back to sign-in.
//
// A STORE TABLET (docs/STORE-TABLET.md in ~/projects/swapup) is different: the
// device keeps a long-lived device token for its store, boot goes to "Who's
// serving?", and an advisor's PIN buys a staff token that lives in memory only.
// Switch, 15 idle minutes on Home / New trade-in / Settings, a staff 401 and an
// app restart all lock it back to the names. Only a manager removing the tablet
// (a 401 on the device token) sends it to sign-in.
import "../shared/platform"; // browser shims (Alert, BackHandler) — a no-op on native
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, BackHandler, Linking, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ApiError, createClient } from "../shared/api";
import { DEFAULT_SERVER, IS_WEB } from "../shared/config";
import { idleLocks, isIdle } from "./pin";
import { Home } from "./screens/Home";
import { NewTradeIn } from "./screens/NewTradeIn";
import { SessionScreen } from "./screens/Session";
import { Settings } from "./screens/Settings";
import { SignIn, staffProblem } from "./screens/SignIn";
import { TabletLock } from "./screens/TabletLock";
import { WebScreen } from "./screens/Web";
import { staffClient, errText } from "./staffClient";
import {
  clearDevice,
  clearToken,
  type DeviceInfo,
  loadSaved,
  normaliseServer,
  saveDevice,
  saveDeviceInfo,
  saveServer,
  saveToken,
} from "./storage";
import { readTabletView, type Screen, type SessionLinks, type StaffUser, type StoreDeviceCreated, type TabletView, type TokenResponse } from "./types";
import { Banner, Body, Brand, Btn, H1, useLayout, L } from "./ui";

type Auth = { server: string; token: string; user: StaffUser; expiresAt: string | null };

/** This device is the store tablet. `view` is the last GET /api/tablet (null until it has answered this launch). */
type Tablet = { server: string; token: string; info: DeviceInfo | null; view: TabletView | null };

type Phase =
  | { kind: "booting" }
  /** A saved sign-in (or the store tablet) couldn't be checked (no network, server down). Keep it; let them retry. */
  | { kind: "offline"; server: string; message: string; tablet: boolean }
  | { kind: "signin"; notice?: string }
  /** Store tablet: "Who's serving?" */
  | { kind: "tablet"; notice?: string }
  | { kind: "in"; auth: Auth };

const ENDED = "Your sign-in has ended — they last 12 hours. Sign in again.";
const TABLET_ENDED = "That sign-in ended. Tap your name to carry on.";
const TABLET_IDLE = "Locked after 15 minutes without a touch. Tap your name to carry on.";
const TABLET_STOPPED = "This device is no longer the store tablet. Sign in with your username and password.";
/** How often the idle clock is looked at. The clock itself is the time of the last touch. */
const IDLE_CHECK_MS = 15_000;

/** GET /api/me answers with the user object; accept { user } too. */
function readUser(x: unknown): StaffUser | null {
  if (!x || typeof x !== "object") return null;
  const o = x as { user?: unknown; id?: unknown; role?: unknown };
  const u = o.user && typeof o.user === "object" ? (o.user as StaffUser) : (x as StaffUser);
  return typeof u.id === "string" && typeof u.role === "string" ? u : null;
}

/** GET /api/tablet with the device token. */
async function fetchTabletView(t: Tablet): Promise<TabletView> {
  const view = readTabletView(await createClient(t.server, { kind: "device", token: t.token }).get<unknown>("/api/tablet"));
  if (!view) throw new ApiError(500, "The server's answer about this tablet didn't make sense.");
  return view;
}

export function StoreApp() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: L.bg }}>
        <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1, backgroundColor: L.bg }}>
          <Root />
        </SafeAreaView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Root() {
  const [phase, setPhase] = useState<Phase>({ kind: "booting" });
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  // The join link / Wi‑Fi the server returned when each session was created, so
  // reopening a session from Home shows the same QR codes.
  const links = useRef(new Map<string, SessionLinks>());
  // Several polls can 401 at once; only the first one signs the app out.
  const ending = useRef(false);
  // The store tablet, mirrored in a ref so the stable callbacks below (401s,
  // the idle lock) always see the current one.
  const [tablet, setTabletState] = useState<Tablet | null>(null);
  const tabletRef = useRef<Tablet | null>(null);
  const setTablet = useCallback((t: Tablet | null) => {
    tabletRef.current = t;
    setTabletState(t);
  }, []);
  // An invite link (swapupstore://join?invite=CODE[&server=…] or /app/store/?invite=CODE) opens sign-up with the code filled in.
  const [invite, setInvite] = useState<string | undefined>(undefined);
  useEffect(() => {
    const read = (url: string | null) => {
      if (!url) return;
      const m = /[?&]invite=([A-Za-z0-9]{8})\b/.exec(url);
      if (!m) return;
      setInvite(m[1].toUpperCase());
      const sm = /[?&]server=([^&#]+)/.exec(url);
      if (sm && !IS_WEB) {
        try {
          const n = normaliseServer(decodeURIComponent(sm[1]));
          if (n) setServer(n);
        } catch {
          /* ignore a malformed server */
        }
      }
      if (IS_WEB && typeof window !== "undefined" && window.history?.replaceState) {
        // Keep the code out of the address bar once read (it is a credential for a few days).
        const clean = window.location.pathname;
        window.history.replaceState(null, "", clean);
      }
    };
    Linking.getInitialURL().then(read).catch(() => {});
    const sub = Linking.addEventListener("url", (e) => read(e.url));
    return () => sub.remove();
  }, []);

  // ── store tablet ──────────────────────────────────────────────────────────

  /**
   * A shared tablet locks or changes hands: end the web desk's session too. The
   * desk hand-off left a cookie for the person who just left (browser: same
   * origin as this app; Android: the WebView's cookie jar, which React Native's
   * fetch shares), and a desk tab still open would otherwise carry on as them.
   */
  const endDeskSession = useCallback((server: string) => {
    void fetch(`${server.replace(/\/$/, "")}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
  }, []);

  /** The tablet was removed by a manager (or stopped here): forget it, go to sign-in with the sentence. */
  const deviceGone = useCallback(
    async (message: string) => {
      const was = tabletRef.current;
      if (was) endDeskSession(was.server);
      await clearDevice();
      setTablet(null);
      links.current.clear();
      setScreen({ name: "home" });
      setPhase({ kind: "signin", notice: message });
    },
    [setTablet, endDeskSession],
  );

  /** Keep the fresh list, and the names the Offline screen shows next launch. */
  const remember = useCallback(
    (t: Tablet, view: TabletView) => {
      const info: DeviceInfo = { deviceId: view.device.id, deviceName: view.device.name, storeName: view.store.name };
      const was = t.info;
      if (!was || was.deviceId !== info.deviceId || was.deviceName !== info.deviceName || was.storeName !== info.storeName) void saveDeviceInfo(info);
      setTablet({ ...t, info, view });
    },
    [setTablet],
  );

  /** First look this launch (boot, or just set up): any failure decides where the app goes. */
  const openGrid = useCallback(
    async (t: Tablet, notice?: string) => {
      // Nobody is unlocked while the names are up: no desk session may linger from before (a restart, say).
      endDeskSession(t.server);
      try {
        const view = await fetchTabletView(t);
        if (tabletRef.current?.token !== t.token) return;
        remember(t, view);
        setScreen({ name: "home" });
        setPhase({ kind: "tablet", notice });
      } catch (e) {
        if (tabletRef.current?.token !== t.token) return;
        if (e instanceof ApiError && e.status === 401) return deviceGone(e.message);
        // 403: the store was turned down. The tablet isn't removed, but no one can serve from it — say why.
        if (e instanceof ApiError && e.status === 403) {
          setPhase({ kind: "signin", notice: errText(e) });
          return;
        }
        setPhase({ kind: "offline", server: t.server, message: errText(e), tablet: true });
      }
    },
    [deviceGone, remember, endDeskSession],
  );

  /** Re-read the names while the grid is already up: a failure keeps the list it has and says why. */
  const refreshTablet = useCallback(async (): Promise<string | null> => {
    const t = tabletRef.current;
    if (!t) return null;
    try {
      const view = await fetchTabletView(t);
      const now = tabletRef.current;
      if (now?.token === t.token) remember(now, view);
      return null;
    } catch (e) {
      if (tabletRef.current?.token !== t.token) return null;
      if (e instanceof ApiError && e.status === 401) {
        await deviceGone(e.message);
        return null;
      }
      return errText(e);
    }
  }, [deviceGone, remember]);

  /** Back to "Who's serving?". The staff token goes with the phase — it was never saved. */
  const lock = useCallback(
    (notice?: string) => {
      const t = tabletRef.current;
      if (!t) return;
      endDeskSession(t.server);
      setScreen({ name: "home" });
      if (t.view) {
        setPhase({ kind: "tablet", notice });
        // Someone may have joined, set a PIN or left since the list was read.
        void refreshTablet();
      } else {
        setPhase({ kind: "booting" });
        void openGrid(t, notice);
      }
    },
    [openGrid, refreshTablet, endDeskSession],
  );

  // ── launch: restore the saved sign-in (or the store tablet)
  const restore = useCallback(async () => {
    setPhase({ kind: "booting" });
    const saved = await loadSaved();
    // In the browser the server is always the page's own origin (same-origin: no
    // CORS, and the desk hand-off cookie lands where the desk is).
    const base = (IS_WEB ? null : saved.server) || DEFAULT_SERVER;
    setServer(base);
    if (saved.deviceToken) {
      // A store tablet never keeps a person signed in across a restart.
      if (saved.token) await clearToken();
      const t: Tablet = { server: base, token: saved.deviceToken, info: saved.deviceInfo, view: null };
      setTablet(t);
      await openGrid(t);
      return;
    }
    setTablet(null);
    if (!saved.token) {
      setPhase({ kind: "signin" });
      return;
    }
    try {
      const me = await createClient(base, { kind: "bearer", token: saved.token }).get<unknown>("/api/me");
      const user = readUser(me);
      if (!user) throw new ApiError(500, "The server's answer about your account didn't make sense.");
      const problem = staffProblem(user);
      if (problem) {
        await clearToken();
        setPhase({ kind: "signin", notice: problem });
        return;
      }
      ending.current = false;
      setScreen({ name: "home" });
      setPhase({ kind: "in", auth: { server: base, token: saved.token, user, expiresAt: saved.expiresAt } });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        await clearToken();
        setPhase({ kind: "signin", notice: e.status === 401 ? ENDED : errText(e) });
        return;
      }
      setPhase({ kind: "offline", server: base, message: errText(e), tablet: false });
    }
  }, [openGrid, setTablet]);

  useEffect(() => {
    restore();
  }, [restore]);

  // ── a 401 from any staff call: the session is over
  const onUnauthorized = useCallback(() => {
    if (ending.current) return;
    ending.current = true;
    // On the store tablet it only ends this person's turn: the tablet is still the store's.
    if (tabletRef.current) {
      lock(TABLET_ENDED);
      return;
    }
    clearToken().finally(() => {
      setPhase({ kind: "signin", notice: ENDED });
    });
  }, [lock]);

  const auth = phase.kind === "in" ? phase.auth : null;
  // One client per sign-in (screens' effects depend on it, so it must stay stable).
  const api = useMemo(() => (auth ? staffClient(auth.server, auth.token, onUnauthorized) : null), [auth, onUnauthorized]);

  async function signedIn(base: string, res: TokenResponse) {
    const t = tabletRef.current;
    // A tablet belongs to the server that set it up; signing in to another one (Advanced) ends it here.
    const onTablet = !!t && t.server === base;
    if (t && !onTablet) {
      await clearDevice();
      setTablet(null);
    }
    // On the store tablet a password sign-in (a manager, a new advisor who just
    // joined) is kept in memory like a PIN one, so a restart still locks.
    await Promise.all([saveServer(base), onTablet ? clearToken() : saveToken(res.token, res.expiresAt)]);
    ending.current = false;
    links.current.clear();
    setServer(base);
    setScreen({ name: "home" });
    setPhase({ kind: "in", auth: { server: base, token: res.token, user: res.user, expiresAt: res.expiresAt ?? null } });
  }

  /** A PIN (or a new PIN) on "Who's serving?" opened the app for one person. */
  function unlocked(res: TokenResponse) {
    const t = tabletRef.current;
    if (!t) return;
    // The server only unlocks this store's advisors and managers; the app checks anyway, as at sign-in.
    const problem = staffProblem(res.user);
    if (problem) {
      setPhase({ kind: "tablet", notice: problem });
      return;
    }
    ending.current = false;
    setScreen({ name: "home" });
    setPhase({ kind: "in", auth: { server: t.server, token: res.token, user: res.user, expiresAt: res.expiresAt ?? null } });
  }

  async function signOut() {
    await clearToken();
    links.current.clear();
    setScreen({ name: "home" });
    setPhase({ kind: "signin" });
  }

  /** Settings → "Use this device as the store tablet": the manager's own saved sign-in goes, the names come up. */
  async function becomeTablet(res: StoreDeviceCreated) {
    if (!auth) return;
    const info: DeviceInfo = { deviceId: res.device.id, deviceName: res.device.name, storeName: res.store.name };
    await Promise.all([saveDevice(res.deviceToken, info), saveServer(auth.server), clearToken()]);
    const t: Tablet = { server: auth.server, token: res.deviceToken, info, view: null };
    setTablet(t);
    setPhase({ kind: "booting" });
    await openGrid(t);
  }

  // ── idle lock (store tablet): 15 minutes without a touch on Home / New trade-in / Settings
  const lastTouch = useRef(Date.now());
  // Sees every touch on its way down and returns false, so it never takes one from a button or a scroll.
  const onTouchCapture = useCallback(() => {
    lastTouch.current = Date.now();
    return false;
  }, []);
  const idleWatch = phase.kind === "in" && tablet !== null && idleLocks(screen.name);
  useEffect(() => {
    if (!idleWatch) return;
    // Arriving on a lockable screen (back from a session, say) starts the clock afresh.
    lastTouch.current = Date.now();
    const check = () => {
      if (isIdle(lastTouch.current, Date.now())) lock(TABLET_IDLE);
    };
    const timer = setInterval(check, IDLE_CHECK_MS);
    // Timers sleep with the app; check the moment it is back in front.
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") check();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [idleWatch, lock]);

  // ── Android back: one step towards Home, then leave the app. The web desk
  // handles its own back (page history first), so stay out of its way.
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const ph = phaseRef.current;
      // Sign-in opened from "Who's serving?": back returns to the names.
      if (ph.kind === "signin" && tabletRef.current?.view) {
        setPhase({ kind: "tablet" });
        return true;
      }
      if (ph.kind !== "in") return false;
      const sc = screenRef.current;
      if (sc.name === "home" || sc.name === "web") return false;
      setScreen({ name: "home" });
      return true;
    });
    return () => sub.remove();
  }, []);

  // ── render
  function render(): React.ReactElement {
    if (phase.kind === "booting") return <Booting />;

    if (phase.kind === "offline") {
      return (
        <Offline
          server={phase.server}
          message={phase.message}
          tablet={phase.tablet ? { storeName: tablet?.info?.storeName || null } : null}
          onRetry={restore}
          onSignIn={() => {
            // The tablet stays set up: a password sign-in just doesn't wait for the names.
            if (phase.tablet) setPhase({ kind: "signin" });
            else clearToken().finally(() => setPhase({ kind: "signin" }));
          }}
        />
      );
    }

    if (phase.kind === "tablet" && tablet?.view) {
      return (
        <TabletLock
          server={tablet.server}
          deviceToken={tablet.token}
          view={tablet.view}
          notice={phase.notice}
          onUnlocked={unlocked}
          onDeviceGone={(m) => void deviceGone(m)}
          onRefresh={refreshTablet}
          onPasswordSignIn={() => setPhase({ kind: "signin" })}
        />
      );
    }

    if (phase.kind !== "in" || !auth || !api) {
      return (
        <SignIn
          key={`${server}|${invite ?? ""}`}
          initialServer={server}
          initialInvite={invite}
          notice={phase.kind === "signin" ? phase.notice : undefined}
          onBack={tablet ? { label: "‹ Back to Who's serving?", onPress: () => lock() } : undefined}
          onSignedIn={(base, res) => {
            setInvite(undefined);
            return signedIn(base, res);
          }}
        />
      );
    }

    const openWeb = (back: Screen) => (url: string, title: string) => setScreen({ name: "web", url, title, back });
    const thisDevice = tablet ? (tablet.view?.device ?? (tablet.info ? { id: tablet.info.deviceId, name: tablet.info.deviceName } : null)) : null;

    switch (screen.name) {
      case "new":
        return (
          <NewTradeIn
            api={api}
            onCancel={() => setScreen({ name: "home" })}
            onCreated={(l) => {
              links.current.set(l.session.id, l);
              setScreen({ name: "session", id: l.session.id, links: l });
            }}
          />
        );
      case "session":
        return (
          <SessionScreen
            key={screen.id}
            api={api}
            user={auth.user}
            id={screen.id}
            links={screen.links ?? links.current.get(screen.id)}
            onLinks={(l) => links.current.set(l.session.id, l)}
            onBack={() => setScreen({ name: "home" })}
            onSwitch={(id, l) => {
              links.current.set(id, l);
              setScreen({ name: "session", id, links: l });
            }}
            onOpenWeb={openWeb({ name: "session", id: screen.id })}
          />
        );
      case "settings":
        return (
          <Settings
            api={api}
            user={auth.user}
            expiresAt={auth.expiresAt}
            tablet={tablet ? { id: thisDevice?.id ?? null, name: thisDevice?.name ?? null } : null}
            onBack={() => setScreen({ name: "home" })}
            onSignOut={tablet ? () => lock() : signOut}
            onUseAsTablet={becomeTablet}
            onStopTablet={() => void deviceGone(TABLET_STOPPED)}
          />
        );
      case "web":
        return <WebScreen key={screen.url} url={screen.url} title={screen.title} onClose={() => setScreen(screen.back)} />;
      case "home":
      default:
        return (
          <Home
            api={api}
            user={auth.user}
            onNew={() => setScreen({ name: "new" })}
            onOpenSession={(id) => setScreen({ name: "session", id })}
            onSettings={() => setScreen({ name: "settings" })}
            onOpenWeb={openWeb({ name: "home" })}
            onSwitch={tablet ? () => lock() : undefined}
          />
        );
    }
  }

  return (
    <View style={{ flex: 1 }} onStartShouldSetResponderCapture={onTouchCapture}>
      {render()}
    </View>
  );
}

function Booting() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14 }}>
      <Brand style={{ alignItems: "center" }} />
      <ActivityIndicator size="large" color={L.primary} />
      <Body muted>Checking your sign-in…</Body>
    </View>
  );
}

function Offline({
  server,
  message,
  tablet,
  onRetry,
  onSignIn,
}: {
  server: string;
  message: string;
  /** Set when this device is the store tablet: nothing is lost, it just couldn't check in. */
  tablet: { storeName: string | null } | null;
  onRetry: () => void;
  onSignIn: () => void;
}) {
  const { pad } = useLayout();
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: pad }}>
      <View style={{ width: "100%", maxWidth: 520, gap: 16 }}>
        <Brand />
        <H1>Can't reach SwapUp</H1>
        <Banner tone="bad" title={tablet ? "The store tablet couldn't check in" : "Your sign-in couldn't be checked"}>
          {`${message} (Trying ${server}.)`}
        </Banner>
        <Body muted>
          {tablet
            ? `This is still ${tablet.storeName ? `${tablet.storeName}'s` : "the store's"} tablet. Check the Wi‑Fi or mobile data, then try again.`
            : "You're still signed in on this tablet. Check the Wi‑Fi or mobile data, then try again."}
        </Body>
        <Btn title="Try again" onPress={onRetry} big />
        <Btn title={tablet ? "Sign in with username and password" : "Sign in again (or change server)"} kind="ghost" onPress={onSignIn} />
      </View>
    </View>
  );
}
