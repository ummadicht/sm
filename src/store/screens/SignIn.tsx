import React, { useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { ApiError, createClient } from "../../shared/api";
import { DEFAULT_SERVER, IS_WEB } from "../../shared/config";
import { normaliseServer } from "../storage";
import { errText } from "../staffClient";
import type { StaffUser, TokenResponse } from "../types";
import { SignUp } from "./SignUp";
import { Banner, Body, Brand, Btn, Card, Field, H1, useLayout, L } from "../ui";

/** Counter roles only — anything else is turned away with a sentence that says why. */
export function staffProblem(u: StaffUser): string | null {
  if (u.role !== "advisor" && u.role !== "store_manager") {
    return "The store app is for store staff. Sign in with an advisor or store manager account.";
  }
  if (!u.store) return "This account isn't linked to a store yet. Ask your programme admin to add you to a store.";
  return null;
}

export function SignIn({
  initialServer,
  notice,
  initialInvite,
  onSignedIn,
  onBack,
}: {
  initialServer: string;
  notice?: string;
  /** An invite code from a link (swapupstore://join?invite=… or /app/store/?invite=…) opens sign-up directly. */
  initialInvite?: string;
  onSignedIn: (server: string, res: TokenResponse) => void;
  /** On the store tablet: the way back to "Who's serving?" (the tablet stays the tablet). */
  onBack?: { label: string; onPress: () => void };
}) {
  const [signUp, setSignUp] = useState<null | "invite" | "register">(initialInvite ? "invite" : null);
  if (signUp) {
    const base = normaliseServer(initialServer) ?? DEFAULT_SERVER;
    return <SignUp server={base} mode={signUp} initialInvite={initialInvite} onBack={() => setSignUp(null)} onSignedIn={onSignedIn} />;
  }
  return <SignInForm initialServer={initialServer} notice={notice} onSignedIn={onSignedIn} onSignUp={setSignUp} onBack={onBack} />;
}

function SignInForm({
  initialServer,
  notice,
  onSignedIn,
  onSignUp,
  onBack,
}: {
  initialServer: string;
  notice?: string;
  onSignedIn: (server: string, res: TokenResponse) => void;
  onSignUp: (mode: "invite" | "register") => void;
  onBack?: { label: string; onPress: () => void };
}) {
  const { wide, pad } = useLayout();
  const [server, setServer] = useState(initialServer);
  // The browser build always talks to the server that served the page — no server picker there.
  const [advanced, setAdvanced] = useState(!IS_WEB && initialServer !== DEFAULT_SERVER);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setServerError(null);
    const base = normaliseServer(server);
    if (!base) {
      setAdvanced(true);
      setServerError("Enter the server address, like https://swapup.example.com or http://192.168.1.20:4500.");
      return;
    }
    if (!username.trim() || !password) {
      setError("Enter your SwapUp username and password.");
      return;
    }
    setBusy(true);
    try {
      const res = await createClient(base, null).post<TokenResponse>("/api/auth/token", { username: username.trim(), password });
      if (!res || typeof res.token !== "string" || !res.user) throw new ApiError(0, "The server answered, but not with a sign-in. Check the server address under Advanced.");
      const problem = staffProblem(res.user);
      if (problem) throw new ApiError(403, problem);
      setPassword("");
      onSignedIn(base, res);
    } catch (e) {
      let msg = errText(e);
      if (e instanceof ApiError && e.status === 0) {
        msg += ` (Trying ${base}.)`;
        if (base.startsWith("http://") && !IS_WEB) msg += " Make sure this tablet is on the same Wi‑Fi as that computer.";
      }
      if (e instanceof ApiError && e.status === 404) msg = `${base} doesn't look like a SwapUp server (no sign-in there). Check the address under Advanced.`;
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: pad, alignItems: "center" }} keyboardShouldPersistTaps="handled">
        <View style={{ width: "100%", maxWidth: wide ? 520 : 480, gap: 18 }}>
          {onBack ? (
            <Pressable onPress={onBack.onPress} hitSlop={10} accessibilityRole="button" style={({ pressed }) => ({ alignSelf: "flex-start", paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ color: L.fix, fontSize: 18, fontWeight: "700" }}>{onBack.label}</Text>
            </Pressable>
          ) : null}
          <View style={{ gap: 6 }}>
            <Brand style={{ marginBottom: 10 }} />
            <H1>Sign in to your store</H1>
            <Body muted>Use the same username and password as the SwapUp desk on the web.</Body>
          </View>

          {notice ? <Banner tone="warn" title={notice} /> : null}

          <Card style={{ gap: 16 }}>
            <Field
              label="Username"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              returnKeyType="next"
              editable={!busy}
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
              editable={!busy}
            />
            {error ? <Banner tone="bad" title="Couldn't sign in">{error}</Banner> : null}
            <Btn title="Sign in" onPress={submit} busy={busy} big />
          </Card>

          <Card style={{ gap: 10 }}>
            <Text style={{ fontSize: 17, fontWeight: "800", color: L.ink }}>New to SwapUp?</Text>
            <Btn title="Join my store with an invite code" kind="secondary" onPress={() => onSignUp("invite")} />
            <Btn title="Register a new store" kind="ghost" onPress={() => onSignUp("register")} />
          </Card>

          {IS_WEB ? null : (
            <Pressable onPress={() => setAdvanced((v) => !v)} hitSlop={10} accessibilityRole="button">
              <Text style={{ color: L.fix, fontSize: 16, fontWeight: "700" }}>{advanced ? "Hide advanced" : "Advanced"}</Text>
            </Pressable>
          )}
          {advanced ? (
            <Card>
              <Field
                label="Server"
                value={server}
                onChangeText={setServer}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                error={serverError}
                hint={`For testing only. The normal server is ${DEFAULT_SERVER}`}
                editable={!busy}
              />
              {server.trim() !== DEFAULT_SERVER ? (
                <Btn title="Use the normal server" kind="ghost" onPress={() => setServer(DEFAULT_SERVER)} style={{ alignSelf: "flex-start" }} />
              ) : null}
            </Card>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
