// Sign-up for SwapUp Store — two honest paths:
//   • Join my store: a code from your manager → advisor at that store, signed in at once.
//   • Register a new store: you become its manager; the store is PENDING until the
//     programme approves it and sets a credit line (tests and quotes work meanwhile).
import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { ApiError, createClient } from "../../shared/api";
import { errText } from "../staffClient";
import type { TokenResponse } from "../types";
import { Banner, Body, Brand, Btn, Card, Field, H1, Segmented, useLayout, L } from "../ui";

type Mode = "invite" | "register";
type Programme = { id: string; name: string; clientType: string | null; brand: string | null };
type InvitePreview = { storeName: string; city: string | null; programme: string };

const KINDS = [
  { value: "service_center", label: "Service centre" },
  { value: "experience_center", label: "Experience centre" },
  { value: "retail", label: "Retail store" },
] as const;

export function SignUp({
  server,
  mode: initialMode,
  initialInvite,
  onBack,
  onSignedIn,
}: {
  server: string;
  mode: Mode;
  initialInvite?: string;
  onBack: () => void;
  onSignedIn: (server: string, res: TokenResponse) => void;
}) {
  const { wide, pad } = useLayout();
  const [mode, setMode] = useState<Mode>(initialMode);
  const api = createClient(server, null);

  // shared person fields
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [phone, setPhone] = useState("");

  // invite
  const [invite, setInvite] = useState((initialInvite ?? "").toUpperCase());
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  // register
  const [programmes, setProgrammes] = useState<Programme[] | null>(null);
  const [programmeId, setProgrammeId] = useState<string>("");
  const [storeName, setStoreName] = useState("");
  const [city, setCity] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("service_center");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Show which store an invite is for as soon as the code is complete.
  useEffect(() => {
    if (mode !== "invite") return;
    const code = invite.replace(/[\s-]/g, "");
    setPreview(null);
    setPreviewErr(null);
    if (code.length !== 8) return;
    let alive = true;
    api
      .get<InvitePreview>(`/api/signup/invite?code=${encodeURIComponent(code)}`)
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setPreviewErr(errText(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite, mode, server]);

  useEffect(() => {
    if (mode !== "register" || programmes) return;
    api
      .get<{ programmes: Programme[] }>("/api/signup/programmes")
      .then((r) => {
        setProgrammes(r.programmes);
        if (r.programmes.length === 1) setProgrammeId(r.programmes[0].id);
      })
      .catch((e) => setError(errText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, server]);

  function personProblem(needPhone: boolean): string | null {
    if (name.trim().length < 2) return "Enter your full name.";
    if (!/^[a-z0-9._-]{3,32}$/.test(username.trim().toLowerCase())) return "Username: 3–32 lowercase letters, numbers, dot, dash or underscore.";
    if (password.length < 8) return "Choose a password of at least 8 characters.";
    if (password !== password2) return "The two passwords don't match.";
    if (needPhone && !/^[6-9]\d{9}$/.test(phone.replace(/\D/g, ""))) return "Enter a 10-digit Indian mobile number.";
    return null;
  }

  async function submit() {
    setError(null);
    const p = personProblem(mode === "register");
    if (p) return setError(p);
    if (mode === "invite" && !preview) return setError(previewErr ?? "Enter the 8-character invite code from your manager.");
    if (mode === "register") {
      if (!programmeId) return setError("Choose the programme your store belongs to.");
      if (storeName.trim().length < 3) return setError("Enter the store's name as customers know it.");
      if (city.trim().length < 2) return setError("Enter the city.");
    }
    setBusy(true);
    try {
      const person = { username: username.trim().toLowerCase(), password };
      const res =
        mode === "invite"
          ? await api.post<TokenResponse>("/api/signup/join", { inviteCode: invite.replace(/[\s-]/g, ""), name: name.trim(), phone: phone.replace(/\D/g, ""), ...person })
          : await api.post<TokenResponse>("/api/signup/store", {
              programmeId,
              storeName: storeName.trim(),
              storeKind: kind,
              city: city.trim(),
              managerName: name.trim(),
              phone: phone.replace(/\D/g, ""),
              ...person,
            });
      if (!res?.token || !res.user) throw new ApiError(0, "The server answered, but not with a sign-in.");
      setPassword("");
      setPassword2("");
      onSignedIn(server, res);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: pad, alignItems: "center" }} keyboardShouldPersistTaps="handled">
        <View style={{ width: "100%", maxWidth: wide ? 560 : 480, gap: 18, paddingVertical: 12 }}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button">
            <Text style={{ color: L.fix, fontSize: 16, fontWeight: "700" }}>‹ Back to sign in</Text>
          </Pressable>
          <View style={{ gap: 6 }}>
            <Brand style={{ marginBottom: 10 }} />
            <H1>{mode === "invite" ? "Join your store" : "Register a new store"}</H1>
            <Body muted>
              {mode === "invite"
                ? "Your manager gives you an invite code. You choose your own username and password."
                : "For a service centre or experience centre that isn't on SwapUp yet. You become its manager."}
            </Body>
          </View>

          <Segmented
            options={[
              { value: "invite", label: "I have an invite code" },
              { value: "register", label: "Register a store" },
            ]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
          />

          {mode === "invite" ? (
            <Card style={{ gap: 14 }}>
              <Field
                label="Invite code"
                value={invite}
                onChangeText={(t) => setInvite(t.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="8 letters and numbers"
                style={{ fontSize: 24, letterSpacing: 4, fontWeight: "800" }}
                editable={!busy}
              />
              {preview ? (
                <Banner tone="up" title={`You're joining ${preview.storeName}${preview.city ? `, ${preview.city}` : ""}`}>
                  {`Programme: ${preview.programme}. You'll be a counter advisor.`}
                </Banner>
              ) : previewErr ? (
                <Banner tone="bad" title="That code doesn't work">
                  {previewErr}
                </Banner>
              ) : null}
            </Card>
          ) : (
            <Card style={{ gap: 14 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: L.ink }}>Programme</Text>
              {programmes === null ? (
                <Body muted>Loading…</Body>
              ) : programmes.length === 0 ? (
                <Banner tone="warn" title="No programme is open for new stores">
                  Ask your brand or programme contact to add your store, or to send your manager an invite.
                </Banner>
              ) : (
                <View style={{ gap: 8 }}>
                  {programmes.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => setProgrammeId(p.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: programmeId === p.id }}
                      style={{
                        borderWidth: 1.5,
                        borderColor: programmeId === p.id ? L.ink : L.border,
                        backgroundColor: programmeId === p.id ? L.surface2 : L.surface,
                        borderRadius: 12,
                        padding: 14,
                      }}
                    >
                      <Text style={{ fontSize: 16, fontWeight: "700", color: L.ink }}>{p.name}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <Field label="Store name" value={storeName} onChangeText={setStoreName} placeholder="As customers know it" editable={!busy} />
              <Field label="City" value={city} onChangeText={setCity} editable={!busy} />
              <Text style={{ fontSize: 15, fontWeight: "700", color: L.ink }}>Kind of store</Text>
              <Segmented options={KINDS.map((k) => ({ value: k.value, label: k.label }))} value={kind} onChange={setKind} />
              <Banner tone="fix" title="Your store starts as 'waiting for approval'">
                You can sign in, set up the store Wi‑Fi, test customers' phones and see quotes straight away. Taking a trade-in starts once the programme approves
                the store and sets its credit limit.
              </Banner>
            </Card>
          )}

          <Card style={{ gap: 14 }}>
            <Field label="Your full name" value={name} onChangeText={setName} autoComplete="name" editable={!busy} />
            <Field
              label={mode === "register" ? "Mobile number" : "Mobile number (optional)"}
              value={phone}
              onChangeText={(t) => setPhone(t.replace(/[^\d+\s]/g, ""))}
              keyboardType="phone-pad"
              placeholder="10 digits"
              editable={!busy}
            />
            <Field
              label="Choose a username"
              value={username}
              onChangeText={(t) => setUsername(t.toLowerCase())}
              autoCapitalize="none"
              autoCorrect={false}
              hint="3–32 lowercase letters, numbers, dot, dash or underscore."
              editable={!busy}
            />
            <Field label="Choose a password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" hint="At least 8 characters." editable={!busy} />
            <Field label="Type the password again" value={password2} onChangeText={setPassword2} secureTextEntry autoCapitalize="none" editable={!busy} onSubmitEditing={submit} />
            {error ? (
              <Banner tone="bad" title="Couldn't sign you up">
                {error}
              </Banner>
            ) : null}
            <Btn title={mode === "invite" ? "Join and sign in" : "Register the store"} onPress={submit} busy={busy} big />
          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
