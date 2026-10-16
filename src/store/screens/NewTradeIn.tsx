import React, { useState } from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { StaffClient, errText } from "../staffClient";
import type { SessionLinks } from "../types";
import { Banner, Body, Btn, Card, Field, H1, TopBar, useLayout } from "../ui";

/** Indian mobile: 10 digits starting 6–9, with an optional +91 / 0 in front. Empty is fine. */
export function normaliseMobile(input: string): { ok: true; value: string | null } | { ok: false } {
  const digits = input.replace(/[\s\-().]/g, "");
  if (!digits) return { ok: true, value: null };
  const m = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(digits);
  return m ? { ok: true, value: m[1] } : { ok: false };
}

export function NewTradeIn({ api, onCancel, onCreated }: { api: StaffClient; onCancel: () => void; onCreated: (links: SessionLinks) => void }) {
  const { pad } = useLayout();
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [mobileErr, setMobileErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    const m = normaliseMobile(mobile);
    if (!m.ok) {
      setMobileErr("Enter a 10-digit mobile number, or leave it empty.");
      return;
    }
    setMobileErr(null);
    setBusy(true);
    try {
      const body: { customerName?: string; customerPhone?: string } = {};
      if (name.trim()) body.customerName = name.trim();
      if (m.value) body.customerPhone = m.value;
      const r = await api.post<SessionLinks>("/api/test-sessions", body);
      if (!r?.session?.id) throw new Error("The server didn't return a test session. Try again.");
      onCreated(r);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <TopBar title="New customer trade-in" left={{ label: "‹ Home", onPress: onCancel }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: pad, alignItems: "center" }} keyboardShouldPersistTaps="handled">
          <View style={{ width: "100%", maxWidth: 560, gap: 16 }}>
            <H1>Who's trading in?</H1>
            <Body muted>Both are optional. They go on the case so you can find it later — you can start without them.</Body>
            <Card style={{ gap: 16 }}>
              <Field
                label="Customer name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoComplete="off"
                returnKeyType="next"
                editable={!busy}
                placeholder="Optional"
              />
              <Field
                label="Mobile number"
                value={mobile}
                onChangeText={(t) => {
                  setMobile(t);
                  if (mobileErr) setMobileErr(null);
                }}
                keyboardType="phone-pad"
                autoComplete="off"
                returnKeyType="go"
                onSubmitEditing={create}
                editable={!busy}
                placeholder="Optional · 10 digits"
                error={mobileErr}
              />
              {error ? <Banner tone="bad" title="Couldn't start the trade-in">{error}</Banner> : null}
              <Btn title="Create and show the QR codes" onPress={create} busy={busy} big />
              <Btn title="Back" kind="ghost" onPress={onCancel} disabled={busy} />
            </Card>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
