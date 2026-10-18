// "Who's serving?" — the store tablet's lock screen (docs/STORE-TABLET.md).
// The tablet stays signed in for the STORE with a device token; each advisor
// taps their name and types a 4-digit PIN, which buys the same 12-hour staff
// token a password sign-in would. So hand-over checks, KYM and data-clear ticks
// name the person who actually did them, without a password every morning.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, BackHandler, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { ApiError, createClient, type Client } from "../../shared/api";
import { IS_WEB } from "../../shared/config";
import { PIN_LENGTH, newPinProblem, pinInput } from "../pin";
import { TEST_PROGRAMME, programmeBanner } from "../programme";
import { errText } from "../staffClient";
import type { TabletStaff, TabletView, TokenResponse } from "../types";
import { Banner, Body, Brand, Btn, Card, Chip, Field, H1, H2, TopBar, useLayout, L } from "../ui";

/**
 * A name tapped and then left alone goes back to the grid, so the next person
 * never finds someone else's PIN pad (or a half-typed password) waiting.
 */
const PICK_TIMEOUT_MS = 90_000;
const GAP = 12;

type Picked = { person: TabletStaff; mode: "pin" | "set"; notice?: string };

/** The unlock / set-pin answer is a sign-in; anything else (a proxy page, a wrong server) is said plainly. */
function readSignIn(r: unknown): TokenResponse {
  const o = r as Partial<TokenResponse> | null;
  if (!o || typeof o.token !== "string" || !o.user) throw new ApiError(0, "Not a sign-in answer. Try again.");
  return o as TokenResponse;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function TabletLock({
  server,
  deviceToken,
  view,
  notice,
  onUnlocked,
  onDeviceGone,
  onRefresh,
  onPasswordSignIn,
}: {
  server: string;
  deviceToken: string;
  view: TabletView;
  notice?: string;
  onUnlocked: (res: TokenResponse) => void;
  /** A 401 on the device token: a manager removed this tablet. */
  onDeviceGone: (message: string) => void;
  /** Re-read the staff list (someone joined, set a PIN, left the store). Resolves to a sentence when it couldn't. */
  onRefresh: () => Promise<string | null>;
  /** Managers and first-time setup: the normal username + password sign-in. The tablet stays the tablet. */
  onPasswordSignIn: () => void;
}) {
  // The device token alone can only do three things (list, unlock, set-pin), so it gets its own client.
  const api = useMemo(() => createClient(server, { kind: "device", token: deviceToken }), [server, deviceToken]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [gridNotice, setGridNotice] = useState<string | null>(notice ?? null);
  useEffect(() => setGridNotice(notice ?? null), [notice]);
  const [refreshing, setRefreshing] = useState(false);
  // Bumped by every digit / keystroke so the "walked away" timer restarts.
  const [activity, setActivity] = useState(0);
  const poke = () => setActivity((n) => n + 1);

  useEffect(() => {
    if (!picked) return;
    const t = setTimeout(() => setPicked(null), PICK_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [picked, activity]);

  // Android back on the PIN pad / set-PIN form: back to the names (not out of the app).
  useEffect(() => {
    if (!picked) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setPicked(null);
      return true;
    });
    return () => sub.remove();
  }, [picked]);

  // The grid can sit there for hours: re-read it whenever the tablet wakes up.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") void onRefresh();
    });
    return () => sub.remove();
  }, [onRefresh]);

  async function refresh() {
    setRefreshing(true);
    const problem = await onRefresh();
    setRefreshing(false);
    setGridNotice(problem);
  }

  /** The sentence to show for a failed unlock / set-pin, or null when it moved the screen somewhere else. */
  function failed(e: unknown, person: TabletStaff): string | null {
    if (e instanceof ApiError) {
      if (e.status === 401) {
        onDeviceGone(e.message);
        return null;
      }
      if (e.status === 404) {
        // Not on this store's staff any more: back to a fresh list, saying why.
        setPicked(null);
        setGridNotice(e.message);
        void onRefresh();
        return null;
      }
      if (e.status === 409) {
        // No PIN yet (the list was older than the person's account): set one now.
        setPicked({ person, mode: "set", notice: e.message });
        return null;
      }
    }
    return errText(e);
  }

  if (picked) {
    const back = () => setPicked(null);
    return picked.mode === "pin" ? (
      <PinPad
        key={picked.person.id}
        api={api}
        person={picked.person}
        storeName={view.store.name}
        onActivity={poke}
        onUnlocked={onUnlocked}
        onFailed={(e) => failed(e, picked.person)}
        onForgot={() => setPicked({ person: picked.person, mode: "set" })}
        onBack={back}
      />
    ) : (
      <SetPin
        key={`${picked.person.id}:set`}
        api={api}
        person={picked.person}
        storeName={view.store.name}
        notice={picked.notice}
        onActivity={poke}
        onUnlocked={onUnlocked}
        onFailed={(e) => failed(e, picked.person)}
        onBack={back}
      />
    );
  }

  return (
    <Grid
      view={view}
      notice={gridNotice}
      refreshing={refreshing}
      onRefresh={refresh}
      onPick={(p) => {
        setGridNotice(null);
        setPicked({ person: p, mode: p.hasPin ? "pin" : "set" });
      }}
      onPasswordSignIn={onPasswordSignIn}
    />
  );
}

// ── the names ───────────────────────────────────────────────────────────────

function Grid({
  view,
  notice,
  refreshing,
  onRefresh,
  onPick,
  onPasswordSignIn,
}: {
  view: TabletView;
  notice: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onPick: (p: TabletStaff) => void;
  onPasswordSignIn: () => void;
}) {
  const { pad, content } = useLayout();
  // Two big tiles a row on a phone, three on a small tablet, four on an iPad in landscape.
  const inner = Math.min(content, 960);
  const cols = inner >= 840 ? 4 : inner >= 540 ? 3 : 2;
  const tileW = Math.floor((inner - GAP * (cols - 1)) / cols);
  const where = [view.store.city, view.store.code].filter(Boolean).join(" · ");

  return (
    <ScrollView
      contentContainerStyle={{ flexGrow: 1, padding: pad, alignItems: "center" }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[L.primary]} tintColor={L.primary} />}
    >
      <View style={{ width: inner, gap: 18 }}>
        <View style={{ gap: 6 }}>
          <Brand style={{ marginBottom: 10 }} />
          <H1>Who's serving?</H1>
          <Body muted>
            {view.store.name}
            {where ? ` (${where})` : ""}
            {" · "}
            {view.device.name}
          </Body>
          {programmeBanner(view.org) ? (
            <View style={{ marginTop: 4 }}>
              <Chip text={TEST_PROGRAMME} tone="warn" />
            </View>
          ) : null}
        </View>

        {notice ? <Banner tone="warn" title={notice} /> : null}

        {view.staff.length === 0 ? (
          <Banner tone="muted" title="No staff on this store yet">
            A manager can invite them from Settings.
          </Banner>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
            {view.staff.map((p) => (
              <NameTile key={p.id} person={p} width={tileW} onPress={() => onPick(p)} />
            ))}
          </View>
        )}

        <View style={{ gap: 10, alignItems: "flex-start", marginTop: 6 }}>
          <Pressable onPress={onPasswordSignIn} hitSlop={10} accessibilityRole="button" style={({ pressed }) => ({ paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: L.fix, fontSize: 17, fontWeight: "700" }}>Sign in with password</Text>
          </Pressable>
          <Body muted style={{ fontSize: 15, lineHeight: 21 }}>
            {IS_WEB ? "Someone missing? Reload the page." : "Someone missing? Pull down to refresh."}
          </Body>
        </View>
      </View>
    </ScrollView>
  );
}

function NameTile({ person, width, onPress }: { person: TabletStaff; width: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${person.name}, ${person.roleLabel || person.role}${person.hasPin ? "" : ", no PIN yet"}`}
      style={({ pressed }) => ({
        width,
        minHeight: 132,
        padding: 16,
        gap: 8,
        borderRadius: L.cardRadius,
        borderWidth: 1.5,
        borderColor: pressed ? L.primary : "transparent",
        backgroundColor: pressed ? L.tint : L.surface,
      })}
    >
      <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: L.tint, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: L.brand, fontSize: 18, fontWeight: "800" }}>{initials(person.name)}</Text>
      </View>
      <H2 style={{ fontSize: 20, lineHeight: 25 }} numberOfLines={2}>
        {person.name}
      </H2>
      <Text style={{ color: L.muted, fontSize: 15 }} numberOfLines={1}>
        {person.roleLabel || person.role}
      </Text>
      {person.hasPin ? null : <Chip text="No PIN yet" tone="warn" />}
    </Pressable>
  );
}

// ── PIN pad ─────────────────────────────────────────────────────────────────

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"] as const;

function PinPad({
  api,
  person,
  storeName,
  onActivity,
  onUnlocked,
  onFailed,
  onForgot,
  onBack,
}: {
  api: Client;
  person: TabletStaff;
  storeName: string;
  onActivity: () => void;
  onUnlocked: (res: TokenResponse) => void;
  onFailed: (e: unknown) => string | null;
  onForgot: () => void;
  onBack: () => void;
}) {
  const { pad, content } = useLayout();
  const [digits, setDigits] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Refs, not state, decide what a key press does: two fast taps must not both see the same "3 digits".
  const typed = useRef("");
  const sending = useRef(false);

  async function submit(pin: string) {
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      onUnlocked(readSignIn(await api.post<unknown>("/api/tablet/unlock", { userId: person.id, pin })));
    } catch (e) {
      // Wrong PIN, locked, offline: start again from an empty pad, with the server's sentence.
      typed.current = "";
      setDigits("");
      const msg = onFailed(e);
      if (msg) setError(msg);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function press(d: string) {
    if (sending.current || typed.current.length >= PIN_LENGTH) return;
    onActivity();
    const next = typed.current + d;
    typed.current = next;
    setDigits(next);
    if (next.length === PIN_LENGTH) void submit(next);
  }
  function erase() {
    if (sending.current) return;
    onActivity();
    typed.current = typed.current.slice(0, -1);
    setDigits(typed.current);
  }

  // iPad / laptop with a keyboard (browser build): digits, Backspace and Escape work too.
  useEffect(() => {
    if (!IS_WEB || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") erase();
      else if (e.key === "Escape") onBack();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const avail = Math.min(content, 380);
  const keyW = Math.min(104, Math.floor((avail - 2 * 14) / 3));
  const keyH = Math.max(60, Math.min(80, Math.round(keyW * 0.75)));

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={person.name} subtitle={storeName} left={{ label: "‹ Not you?", onPress: onBack }} />
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: pad, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: avail, gap: 18, alignItems: "center" }}>
          <H2 style={{ textAlign: "center" }}>Type your PIN</H2>
          <View style={{ flexDirection: "row", gap: 18, paddingVertical: 4 }} accessibilityLabel={`${digits.length} of ${PIN_LENGTH} digits typed`}>
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <View
                key={i}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  borderWidth: 2,
                  borderColor: error ? L.bad : L.ink,
                  backgroundColor: i < digits.length ? L.ink : "transparent",
                }}
              />
            ))}
          </View>
          <View style={{ minHeight: 52, alignSelf: "stretch", justifyContent: "center" }}>
            {busy ? <ActivityIndicator color={L.primary} /> : error ? <Banner tone="bad" title={error} /> : null}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, width: keyW * 3 + 28 }}>
            {KEYS.map((k, i) =>
              k === "" ? (
                <View key={i} style={{ width: keyW, height: keyH }} />
              ) : (
                <Pressable
                  key={i}
                  onPress={() => (k === "⌫" ? erase() : press(k))}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={k === "⌫" ? "Delete the last digit" : k}
                  style={({ pressed }) => ({
                    width: keyW,
                    height: keyH,
                    borderRadius: 999,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: k === "⌫" ? "transparent" : pressed ? L.tint : L.surface,
                    borderWidth: k === "⌫" ? 0 : 1.5,
                    borderColor: pressed ? L.primary : "transparent",
                    opacity: busy ? 0.5 : pressed && k === "⌫" ? 0.6 : 1,
                  })}
                >
                  <Text style={{ color: L.ink, fontSize: k === "⌫" ? 26 : 30, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{k}</Text>
                </Pressable>
              ),
            )}
          </View>
          <Pressable onPress={onForgot} hitSlop={10} accessibilityRole="button" style={({ pressed }) => ({ paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: L.fix, fontSize: 16, fontWeight: "700", textAlign: "center" }}>Forgot PIN?</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Set your PIN ────────────────────────────────────────────────────────────

function SetPin({
  api,
  person,
  storeName,
  notice,
  onActivity,
  onUnlocked,
  onFailed,
  onBack,
}: {
  api: Client;
  person: TabletStaff;
  storeName: string;
  notice?: string;
  onActivity: () => void;
  onUnlocked: (res: TokenResponse) => void;
  onFailed: (e: unknown) => string | null;
  onBack: () => void;
}) {
  const { pad } = useLayout();
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!password) {
      setError("Type your SwapUp password.");
      return;
    }
    // Same rule as the server, so a guessable PIN is turned down before the round trip.
    const problem = newPinProblem(pin, repeat);
    setPinErr(problem);
    if (problem) return;
    setBusy(true);
    try {
      onUnlocked(readSignIn(await api.post<unknown>("/api/tablet/set-pin", { userId: person.id, password, pin })));
    } catch (e) {
      // A wrong password counts as a wrong try on the server; clear it so the next attempt starts clean.
      if (e instanceof ApiError && e.status === 403) setPassword("");
      const msg = onFailed(e);
      if (msg) setError(msg);
      setBusy(false);
    }
  }

  const typed = (set: (v: string) => void) => (v: string) => {
    onActivity();
    set(v);
  };

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={person.name} subtitle={storeName} left={{ label: "‹ Not you?", onPress: onBack }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: pad, alignItems: "center", justifyContent: "center" }} keyboardShouldPersistTaps="handled">
          <View style={{ width: "100%", maxWidth: 520, gap: 16 }}>
            <View style={{ gap: 6 }}>
              <H1>Set your PIN</H1>
              <Body muted>Your password once, then a 4-digit PIN.</Body>
            </View>
            {notice ? <Banner tone="warn" title={notice} /> : null}
            <Card style={{ gap: 16 }}>
              <Field
                label="Your SwapUp password"
                value={password}
                onChangeText={typed(setPassword)}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="password"
                textContentType="password"
                returnKeyType="next"
                editable={!busy}
              />
              <Field
                label="New PIN"
                value={pin}
                onChangeText={typed((v) => setPin(pinInput(v)))}
                secureTextEntry
                keyboardType="number-pad"
                maxLength={PIN_LENGTH}
                autoComplete="off"
                hint="4 digits — not 1111 or 1234."
                error={pinErr}
                editable={!busy}
              />
              <Field
                label="Type the PIN again"
                value={repeat}
                onChangeText={typed((v) => setRepeat(pinInput(v)))}
                secureTextEntry
                keyboardType="number-pad"
                maxLength={PIN_LENGTH}
                autoComplete="off"
                returnKeyType="go"
                onSubmitEditing={submit}
                editable={!busy}
              />
              {error ? <Banner tone="bad" title="Couldn't set your PIN">{error}</Banner> : null}
              <Btn title="Save PIN" onPress={submit} busy={busy} big />
            </Card>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
