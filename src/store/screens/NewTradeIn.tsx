// New customer trade-in: the IMEI FIRST (owner, 2026-10-19: "Scan IMEI first ... by *#06#") —
// the customer dials *#06#, the advisor scans it, has the server read the screen, or types it
// (./ImeiCard.tsx) — or "Skip — scan at hand-over" (Take the trade-in asks for it then, as before).
// Then the customer's mobile number: at 10 digits the app looks it up (GET /api/customers?phone=,
// ../customers.ts) — a returning customer's name fills in and their earlier trade-ins are listed;
// a new one gets a name field. Both stay optional.
// Start (../imei.ts startTradeIn): with an IMEI, POST /api/cases → PATCH {imei, imei2} (the server
// looks it up: model, GSMA blacklist) → a blacklisted phone stops HERE, before any test → POST
// /api/test-sessions {caseId}. Skipped: today's one call. What the server found shows on the
// Session screen's IMEI card, with the government check (KYM) to send while the phone tests.
import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { ApiError } from "../../shared/api";
import { StaffClient, errText } from "../staffClient";
import type { SessionLinks } from "../types";
import { normaliseMobile, pastTradeInLine, readCustomerLookup, type CustomerLookup } from "../customers";
import { type Scanned, startTradeIn } from "../imei";
import { readCaseHead } from "../offer";
import { ImeiCapture, ImeiFound, ImeiLater, ImeiStop, SKIP_TITLE } from "./ImeiCard";
import { Banner, Body, Btn, Card, Field, H1, Label, TopBar, useLayout, L } from "../ui";

export { normaliseMobile } from "../customers";

/** What the lookup knows about the number typed so far. */
type Lookup =
  | { state: "idle" }
  | { state: "busy"; phone: string }
  | { state: "found"; phone: string; result: CustomerLookup }
  /** The server can't look numbers up (older server, or not allowed for this role): just type the name. */
  | { state: "unavailable"; phone: string; why: string | null };

/** Said above Start until the IMEI card has an answer. */
export const IMEI_FIRST = "Scan the IMEI first — or skip it.";

export function NewTradeIn({
  api,
  onCancel,
  onCreated,
}: {
  api: StaffClient;
  onCancel: () => void;
  /** `imeiSkipped`: the advisor chose "scan at hand-over" — the Session screen keeps the card folded. */
  onCreated: (links: SessionLinks, imeiSkipped: boolean) => void;
}) {
  const { pad } = useLayout();
  const [imei, setImei] = useState<Scanned | null>(null);
  const [skipped, setSkipped] = useState(false);
  /** A Start that stopped or failed after opening the case: the next one uses the same case. */
  const [caseId, setCaseId] = useState<string | null>(null);
  /** The IMEI 1 that case holds, as its last IMEI save answered (null = none, or not known): a new one clears the old IMEI 2. */
  const [caseImei, setCaseImei] = useState<string | null>(null);
  /** The case as the IMEI save answered (what the server found), and why the trade-in stops. */
  const [caseView, setCaseView] = useState<unknown>(null);
  const [stop, setStop] = useState<string | null>(null);
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

  const ready = !!imei?.imei || skipped;

  async function create() {
    setError(null);
    if (!ready || stop) return;
    if (!m.ok) {
      setMobileErr("10 digits, or leave it empty.");
      return;
    }
    setMobileErr(null);
    setBusy(true);
    const r = await startTradeIn(api, { customerName: name, customerPhone: m.value, imei: skipped ? null : imei, caseId, caseImei });
    if (r.kind === "started") {
      onCreated(r.links, skipped || !imei?.imei);
      return;
    }
    setCaseId(r.caseId);
    setCaseImei(readCaseHead(r.caseView)?.imei ?? null);
    setCaseView(r.caseView);
    if (r.kind === "stopped") setStop(r.text);
    else setError(r.text);
    setBusy(false);
  }

  /** A new IMEI (or none): what the server said about the old one goes with it; the case stays. */
  function changeImei(v: Scanned | null) {
    setImei(v);
    setCaseView(null);
    setStop(null);
    setError(null);
  }
  const imeiHead = caseView && imei?.imei ? readCaseHead(caseView) : null;

  const found = lookup.state === "found" ? lookup.result : null;
  const returning = !!found?.customer;
  const history = found?.history ?? [];

  return (
    <View style={{ flex: 1 }}>
      <TopBar title="New customer trade-in" left={{ label: "‹ Home", onPress: onCancel }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "web" ? undefined : "padding"}>
        <ScrollView contentContainerStyle={{ padding: pad, alignItems: "center" }} keyboardShouldPersistTaps="handled">
          <View style={{ width: "100%", maxWidth: 560, gap: 16 }}>
            {/* 1 · the IMEI, first */}
            <Card style={{ gap: 12 }}>
              {skipped ? (
                <ImeiLater onScan={() => setSkipped(false)} />
              ) : (
                <ImeiCapture api={api} value={imei} onChange={changeImei} skip={{ title: SKIP_TITLE, onPress: () => setSkipped(true) }} busy={busy}>
                  {imeiHead ? <ImeiFound head={imeiHead} /> : null}
                </ImeiCapture>
              )}
              <ImeiStop text={stop} />
            </Card>

            {/* 2 · who */}
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
              {!ready ? <Text style={{ color: L.muted, fontSize: 15, lineHeight: 21, textAlign: "center" }}>{IMEI_FIRST}</Text> : null}
              <Btn title="Start" onPress={create} busy={busy} disabled={!ready || !!stop} big />
              <Btn title="Back" kind="ghost" onPress={onCancel} disabled={busy} />
            </Card>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
