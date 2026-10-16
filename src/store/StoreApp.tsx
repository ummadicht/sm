// SwapUp Store — the staff app at the service-centre counter.
//
// Navigation is a small state machine (no router): boot → sign in → home ⇄
// new trade-in / session / settings / web desk. The staff token lives in the
// OS keystore (expo-secure-store) and is checked against GET /api/me on launch;
// any 401 anywhere sends the app back to sign-in.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ApiError, createClient } from "../shared/api";
import { DEFAULT_SERVER } from "../shared/config";
import { L } from "../shared/theme";
import { Home } from "./screens/Home";
import { NewTradeIn } from "./screens/NewTradeIn";
import { SessionScreen } from "./screens/Session";
import { Settings } from "./screens/Settings";
import { SignIn, staffProblem } from "./screens/SignIn";
import { WebScreen } from "./screens/Web";
import { staffClient, errText } from "./staffClient";
import { clearToken, loadSaved, saveServer, saveToken } from "./storage";
import type { Screen, SessionLinks, StaffUser, TokenResponse } from "./types";
import { Banner, Body, Btn, H1, useLayout } from "./ui";

type Auth = { server: string; token: string; user: StaffUser; expiresAt: string | null };

type Phase =
  | { kind: "booting" }
  /** A saved sign-in couldn't be checked (no network, server down). Keep it; let them retry. */
  | { kind: "offline"; server: string; token: string; expiresAt: string | null; message: string }
  | { kind: "signin"; notice?: string }
  | { kind: "in"; auth: Auth };

const ENDED = "Your sign-in has ended — they last 12 hours. Sign in again.";

/** GET /api/me answers with the user object; accept { user } too. */
function readUser(x: unknown): StaffUser | null {
  if (!x || typeof x !== "object") return null;
  const o = x as { user?: unknown; id?: unknown; role?: unknown };
  const u = o.user && typeof o.user === "object" ? (o.user as StaffUser) : (x as StaffUser);
  return typeof u.id === "string" && typeof u.role === "string" ? u : null;
}

export function StoreApp() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: L.surface }}>
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

  // ── launch: restore the saved sign-in
  const restore = useCallback(async () => {
    setPhase({ kind: "booting" });
    const saved = await loadSaved();
    const base = saved.server || DEFAULT_SERVER;
    setServer(base);
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
      setPhase({ kind: "offline", server: base, token: saved.token, expiresAt: saved.expiresAt, message: errText(e) });
    }
  }, []);

  useEffect(() => {
    restore();
  }, [restore]);

  // ── a 401 from any staff call: the session is over
  const onUnauthorized = useCallback(() => {
    if (ending.current) return;
    ending.current = true;
    clearToken().finally(() => {
      setPhase({ kind: "signin", notice: ENDED });
    });
  }, []);

  const auth = phase.kind === "in" ? phase.auth : null;
  // One client per sign-in (screens' effects depend on it, so it must stay stable).
  const api = useMemo(() => (auth ? staffClient(auth.server, auth.token, onUnauthorized) : null), [auth, onUnauthorized]);

  async function signedIn(base: string, res: TokenResponse) {
    await Promise.all([saveServer(base), saveToken(res.token, res.expiresAt)]);
    ending.current = false;
    links.current.clear();
    setServer(base);
    setScreen({ name: "home" });
    setPhase({ kind: "in", auth: { server: base, token: res.token, user: res.user, expiresAt: res.expiresAt ?? null } });
  }

  async function signOut() {
    await clearToken();
    links.current.clear();
    setScreen({ name: "home" });
    setPhase({ kind: "signin" });
  }

  // ── Android back: one step towards Home, then leave the app. The web desk
  // handles its own back (page history first), so stay out of its way.
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (phaseRef.current.kind !== "in") return false;
      const sc = screenRef.current;
      if (sc.name === "home" || sc.name === "web") return false;
      setScreen({ name: "home" });
      return true;
    });
    return () => sub.remove();
  }, []);

  // ── render
  if (phase.kind === "booting") return <Booting />;

  if (phase.kind === "offline") {
    return (
      <Offline
        server={phase.server}
        message={phase.message}
        onRetry={restore}
        onSignIn={() => {
          clearToken().finally(() => setPhase({ kind: "signin" }));
        }}
      />
    );
  }

  if (phase.kind === "signin" || !auth || !api) {
    return <SignIn key={server} initialServer={server} notice={phase.kind === "signin" ? phase.notice : undefined} onSignedIn={signedIn} />;
  }

  const openWeb = (back: Screen) => (url: string, title: string) => setScreen({ name: "web", url, title, back });

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
      return <Settings api={api} user={auth.user} expiresAt={auth.expiresAt} onBack={() => setScreen({ name: "home" })} onSignOut={signOut} />;
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
        />
      );
  }
}

function Booting() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14 }}>
      <Text style={{ color: L.up, fontSize: 16, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" }}>SwapUp Store</Text>
      <ActivityIndicator size="large" color={L.up} />
      <Body muted>Checking your sign-in…</Body>
    </View>
  );
}

function Offline({ server, message, onRetry, onSignIn }: { server: string; message: string; onRetry: () => void; onSignIn: () => void }) {
  const { pad } = useLayout();
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: pad }}>
      <View style={{ width: "100%", maxWidth: 520, gap: 16 }}>
        <Text style={{ color: L.up, fontSize: 16, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" }}>SwapUp Store</Text>
        <H1>Can't reach SwapUp</H1>
        <Banner tone="bad" title="Your sign-in couldn't be checked">
          {`${message} (Trying ${server}.)`}
        </Banner>
        <Body muted>You're still signed in on this tablet. Check the Wi‑Fi or mobile data, then try again.</Body>
        <Btn title="Try again" onPress={onRetry} big />
        <Btn title="Sign in again (or change server)" kind="ghost" onPress={onSignIn} />
      </View>
    </View>
  );
}
