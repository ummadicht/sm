// New customer trade-in: the customer's mobile number FIRST. At 10 digits the app
// looks the number up (GET /api/customers?phone=, ../customers.ts) — a returning
// customer's name fills in and their earlier trade-ins are listed; a new one gets a
// name field. Both stay optional, and the create call is the same as before.
import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { ApiError } from "../../shared/api";
import { StaffClient, errText } from "../staffClient";
import type { SessionLinks } from "../types";
import { normaliseMobile, pastTradeInLine, readCustomerLookup, type CustomerLookup } from "../customers";
import { Banner, Body, Btn, Card, Field, H1, Label, TopBar, useLayout, L } from "../ui";

export { normaliseMobile } from "../customers";

/** What the lookup knows about the number typed so far. */
type Lookup =
  | { state: "idle" }
  | { state: "busy"; phone: string }
  | { state: "found"; phone: string; result: CustomerLookup }
  /** The server can't look numbers up (older server, or not allowed for this role): just type the name. */
  | { state: "unavailable"; phone: string; why: string | null };

export function NewTradeIn({ api, onCancel, onCreated }: { api: StaffClient; onCancel: () => void; onCreated: (links: SessionLinks) => void }) {
  const { pad } = useLayout();
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [mobileErr, setMobileErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  /** The name the lookup filled in — cleared again if the number changes, never what the advisor typed. */
  const filled = useRef<string | null>(null);

  const m = normaliseMobile(mobile);
  const phone = m.ok ? m.value : null;
  const nameNow = useRef(name);
  nameNow.current = name;

  // Look the number up once it is a whole one. A newer number wins over a slower
  // answer for an older one, and a name filled in for the old number goes with it
  // (unless the advisor has typed over it since).
  useEffect(() => {
    if (filled.current !== null) {
      if (nameNow.current === filled.current) setName("");
      filled.current = null;
    }
    if (!phone) {
      setLookup({ state: "idle" });
      return;
    }
    let alive = true;
    setLookup({ state: "busy", phone });
    api
      .get<unknown>(`/api/customers?phone=${encodeURIComponent(phone)}`)
      .then((r) => {
        if (!alive) return;
        const result = readCustomerLookup(r);
        if (!result) return setLookup({ state: "unavailable", phone, why: null });
        setLookup({ state: "found", phone, result });
        const known = result.customer?.name ?? null;
        if (known && !nameNow.current.trim()) {
          filled.current = known;
          setName(known);
        }
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // 404 = a server without the route; 403 = a role it isn't offered to. Neither is
        // worth a warning — the advisor types the name, as before.
        const quiet = e instanceof ApiError && (e.status === 404 || e.status === 403);
        setLookup({ state: "unavailable", phone, why: quiet ? null : errText(e) });
      });
    return () => {
      alive = false;
    };
  }, [api, phone]);

  async function create() {
    setError(null);
    if (!m.ok) {
      setMobileErr("10 digits, or leave it empty.");
      return;
    }
    setMobileErr(null);
    setBusy(true);
    try {
      const body: { customerName?: string; customerPhone?: string } = {};
      if (name.trim()) body.customerName = name.trim();
      if (m.value) body.customerPhone = m.value;
      const r = await api.post<SessionLinks>("/api/test-sessions", body);
      if (!r?.session?.id) throw new Error("No test came back. Try again.");
      onCreated(r);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  const found = lookup.state === "found" ? lookup.result : null;
  const returning = !!found?.customer;
  const history = found?.history ?? [];

  return (
    <View style={{ flex: 1 }}>
      <TopBar title="New customer trade-in" left={{ label: "‹ Home", onPress: onCancel }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: pad, alignItems: "center" }} keyboardShouldPersistTaps="handled">
          <View style={{ width: "100%", maxWidth: 560, gap: 16 }}>
            <H1>Who's trading in?</H1>
            <Body muted>Both optional.</Body>
            <Card style={{ gap: 16 }}>
              <Field
                label="Mobile number"
                value={mobile}
                onChangeText={(t) => {
                  setMobile(t);
                  if (mobileErr) setMobileErr(null);
                }}
                keyboardType="phone-pad"
                autoComplete="off"
                autoFocus
                returnKeyType="next"
                editable={!busy}
                placeholder="10 digits"
                error={mobileErr}
              />

              {lookup.state === "busy" ? <Text style={{ color: L.muted, fontSize: 15 }}>Looking up…</Text> : null}
              {found ? (
                returning ? (
                  <Banner tone="up" title={`Returning customer · ${found.customer!.name}`}>
                    <View style={{ gap: 6 }}>
                      <Text style={{ fontSize: 16, color: L.text, lineHeight: 22 }}>
                        {history.length === 0
                          ? "No earlier trade-ins."
                          : history.length === 1
                            ? "1 earlier trade-in:"
                            : `${history.length >= 10 ? "10+" : history.length} earlier trade-ins · latest:`}
                      </Text>
                      {history[0] ? <Text style={{ fontSize: 16, color: L.ink, fontWeight: "700", lineHeight: 22 }}>{pastTradeInLine(history[0])}</Text> : null}
                    </View>
                  </Banner>
                ) : (
                  <View style={{ gap: 4 }}>
                    <Label>New customer</Label>
                    <Body muted>
                      {history.length
                        ? `${history.length === 1 ? "1 earlier trade-in" : `${history.length} earlier trade-ins`} · latest ${pastTradeInLine(history[0])}`
                        : "First trade-in."}
                    </Body>
                  </View>
                )
              ) : null}
              {lookup.state === "unavailable" && lookup.why ? <Text style={{ color: L.muted, fontSize: 15 }}>{`Lookup failed (${lookup.why}).`}</Text> : null}

              <Field
                label="Customer name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoComplete="off"
                returnKeyType="go"
                onSubmitEditing={create}
                editable={!busy}
                placeholder="Optional"
                hint={returning && name === found?.customer?.name ? "From their last trade-in." : undefined}
              />
              {error ? <Banner tone="bad" title="Couldn't start the trade-in">{error}</Banner> : null}
              <Btn title="Start" onPress={create} busy={busy} big />
              <Btn title="Back" kind="ghost" onPress={onCancel} disabled={busy} />
            </Card>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
