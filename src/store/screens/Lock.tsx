// TAKE THE TRADE-IN — only the checks the law and the money need, in the desk's words
// (../lock.ts holds the form's rules and the payload, tested under node):
//   1 the IMEI, only when the case has none (typed, or scanned off the box) → 2 the customer
//   (prefilled, editable in place) → 3 the ID document seen and its last 4 → 4 the government
//   IMEI check (KYM SMS to 14422, and again for IMEI 2 when the case has one; the answer only
//   once there is an IMEI, cleared when an IMEI changes) → 5 the hand-over ticks (+ "Settings ›
//   About phone shows …" when the customer typed the storage, + the IMEI re-read when a check
//   digit fails) → the pill.
// The server is the judge (lockTradeIn). The pill stays off while the server or the form has a
// problem and says it above the pill — a server blocker first, since nothing in the form can
// fix it; a refusal comes back in the server's words and the case is re-read.
// On success the app goes back to the answer screen, which then shows "Traded in".
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, KeyboardAvoidingView, Linking, Platform, ScrollView, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Notice, Option } from "../../shared/kit";
import { type LockForm, afterImeiChange, emptyLockForm, kymOpen, kymSends, kymText, lockBody, lockCaption, lockProblem, lockTicks, serverBlocker, ID_TYPES, KYM } from "../lock";
import { type CaseHead, type Offer, readCaseHead, readOffer } from "../offer";
import { imeiCheck } from "../phoneLed";
import { type StaffClient, errText } from "../staffClient";
import { Banner, Body, Btn, Card, Field, H2, KV, L, Label, Segmented, TopBar, inr, useLayout } from "../ui";

const IS_WEB = Platform.OS === "web";
const MAX_W = 760;

type Load = { state: "loading" } | { state: "error"; text: string } | { state: "ready"; head: CaseHead; offer: Offer | null };

export function LockScreen({ api, caseId, caseRef, onBack, onDone }: { api: StaffClient; caseId: string; caseRef: string; onBack: () => void; onDone: () => void }) {
  const { pad, content } = useLayout();
  const path = `/api/cases/${encodeURIComponent(caseId)}`;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [form, setForm] = useState<LockForm | null>(null);
  const [imeiText, setImeiText] = useState("");
  const [imeiBusy, setImeiBusy] = useState(false);
  const [imeiErr, setImeiErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [locking, setLocking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** The IMEIs the form was last filled against: a KYM answer is for those numbers only. */
  const imeis = useRef<{ imei: string | null; imei2: string | null } | null>(null);

  const take = useCallback((r: unknown) => {
    const head = readCaseHead(r);
    if (!head) throw new Error("The server's answer about this case didn't make sense.");
    setLoad({ state: "ready", head, offer: readOffer((r as { offer?: unknown }).offer) });
    const before = imeis.current;
    imeis.current = { imei: head.imei, imei2: head.imei2 };
    // Name and mobile start from the case once; after that they are the advisor's typing.
    // A new IMEI (typed here, or changed on the desk) clears the KYM answer given for the old one.
    setForm((f) => (f ? afterImeiChange(f, before, head) : emptyLockForm(head)));
  }, []);

  const fetchCase = useCallback(
    async (quiet: boolean) => {
      if (!quiet) setLoad({ state: "loading" });
      try {
        const r = await api.get<unknown>(path);
        if (alive.current) take(r);
      } catch (e) {
        if (alive.current && !quiet) setLoad({ state: "error", text: errText(e) });
      }
    },
    [api, path, take]
  );

  useEffect(() => {
    void fetchCase(false);
    // The credit line or a quote may have moved while the app was away.
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") void fetchCase(true);
    });
    return () => sub.remove();
  }, [fetchCase]);

  /** PATCH {imei}: the server re-checks it and answers with the case (the IMEI step then goes). */
  async function saveImei(imei: string) {
    setImeiErr(null);
    setImeiBusy(true);
    try {
      const r = await api.patch<unknown>(path, { imei });
      if (alive.current) take(r);
    } catch (e) {
      if (alive.current) setImeiErr(errText(e));
    } finally {
      if (alive.current) setImeiBusy(false);
    }
  }

  function typeImei(t: string) {
    const d = t.replace(/\D/g, "").slice(0, 15);
    setImeiText(d);
    setImeiErr(null);
    // A valid IMEI goes at once — nothing to press.
    if (d.length === 15 && imeiCheck(d) === "ok" && !imeiBusy) void saveImei(d);
  }

  async function lock(head: CaseHead, f: LockForm) {
    setErr(null);
    setLocking(true);
    try {
      await api.post<unknown>(`${path}/action`, { action: "lock", ...lockBody(f, head) });
      if (alive.current) onDone();
    } catch (e) {
      if (!alive.current) return;
      setErr(errText(e));
      // The blockers the server knows now (credit, a quote that just expired…).
      void fetchCase(true);
    } finally {
      if (alive.current) setLocking(false);
    }
  }

  const column = { alignSelf: "center" as const, width: Math.min(content, MAX_W) + pad * 2 };
  const top = <TopBar title="Take the trade-in" subtitle={load.state === "ready" ? load.head.ref || caseRef : caseRef} left={{ label: "‹ The answer", onPress: onBack }} />;

  if (load.state !== "ready" || !form) {
    return (
      <View style={{ flex: 1 }}>
        {top}
        <View style={[column, { padding: pad, gap: 16 }]}>
          {load.state === "error" ? (
            <Banner tone="bad" title="Couldn't load the case" action={{ title: "Try again", onPress: () => void fetchCase(false) }}>
              {load.text}
            </Banner>
          ) : (
            <Body muted>Loading…</Body>
          )}
        </View>
      </View>
    );
  }

  const { head, offer: o } = load;
  const set = (patch: Partial<LockForm>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const askImei = !head.imei;
  const typedCheck = imeiCheck(imeiText);
  const problem = lockProblem(form, head);
  const blocker = serverBlocker(head);
  const caption = lockCaption(form, head);
  const flagged = !!form.kym && form.kym !== "clear";
  const canKym = kymOpen(head);
  const total = o?.swap.total ?? null;
  const old = [head.deviceLabel, head.variant].filter(Boolean).join(" ") || "The customer's phone";

  return (
    <View style={{ flex: 1 }}>
      {top}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={IS_WEB ? undefined : "padding"}>
        <ScrollView contentContainerStyle={[column, { padding: pad, gap: 16 }]} keyboardShouldPersistTaps="handled">
          {/* What the customer gets */}
          <Card style={{ gap: 4 }}>
            <H2>{`${old} → ${o?.swap.newPhone?.label ?? "the new phone"}`}</H2>
            <KV label="Trade-in" value={inr(o?.swap.tradeIn ?? null)} />
            <KV label="Bonus" value={inr(o?.swap.bonus ?? null)} />
            <KV label="Customer pays" value={inr(o?.swap.customerPays ?? null)} />
          </Card>

          {/* 1 · the IMEI, only when the case has none */}
          {askImei ? (
            <Card style={{ gap: 12 }}>
              <Label>IMEI</Label>
              <Body muted>Dial *#06# on the customer's phone, or scan the IMEI barcode on its box.</Body>
              <Field
                label="IMEI 1"
                value={imeiText}
                onChangeText={typeImei}
                keyboardType="number-pad"
                inputMode="numeric"
                placeholder="15 digits"
                maxLength={15}
                editable={!imeiBusy}
                error={imeiErr ?? (imeiText.length === 15 && typedCheck === "bad" ? "That IMEI fails its check digit — re-read it from *#06#." : null)}
                hint={imeiBusy ? "Saving…" : undefined}
                style={{ fontVariant: ["tabular-nums"], letterSpacing: 1.5 }}
              />
              {imeiText.length === 15 && typedCheck === "bad" && !imeiBusy ? (
                // Rare, but real: the server keeps it, and the ticks then ask for the re-read.
                <Btn title="It is correct — record it anyway" kind="ghost" onPress={() => void saveImei(imeiText)} style={{ alignSelf: "flex-start" }} />
              ) : null}
              {!IS_WEB ? (
                scanning ? (
                  <BoxScanner
                    onImei={(d) => {
                      setScanning(false);
                      setImeiText(d);
                      void saveImei(d);
                    }}
                    onStop={() => setScanning(false)}
                  />
                ) : (
                  <Btn title="Scan the box" kind="secondary" onPress={() => setScanning(true)} disabled={imeiBusy} style={{ alignSelf: "flex-start" }} />
                )
              ) : null}
            </Card>
          ) : null}

          {/* 2 · the customer */}
          <Card style={{ gap: 14 }}>
            <Label>Customer</Label>
            <Field label="Customer name" value={form.name} onChangeText={(t) => set({ name: t.slice(0, 80) })} autoComplete="off" autoCorrect={false} />
            <Field
              label="Mobile"
              value={form.phone}
              onChangeText={(t) => set({ phone: t.replace(/[^\d\s+]/g, "").slice(0, 14) })}
              keyboardType="phone-pad"
              inputMode="tel"
              placeholder="10 digits"
            />
          </Card>

          {/* 3 · the ID document seen */}
          <Card style={{ gap: 14 }}>
            <Label>ID document seen</Label>
            <Segmented options={ID_TYPES.map((t) => ({ value: t.id as string, label: t.label }))} value={form.idType} onChange={(v) => set({ idType: v as LockForm["idType"] })} />
            <Field
              label="Last 4 characters of the ID number"
              value={form.idLast4}
              onChangeText={(t) => set({ idLast4: t.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase() })}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={4}
              placeholder="e.g. 4821"
              hint="Only these 4 characters are stored — never the full ID number or a copy of it."
            />
          </Card>

          {/* 4 · the government IMEI check */}
          <Card style={{ gap: 14 }}>
            <Label>Government IMEI check (required)</Label>
            <Body muted>{kymText(head)}</Body>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {kymSends(head).map((b) => (
                <Btn
                  key={b.title}
                  title={b.title}
                  kind="secondary"
                  disabled={b.disabled}
                  onPress={() => {
                    Linking.openURL(b.uri).catch(() => setErr("This device couldn't open the SMS app. Send the SMS from the store phone."));
                  }}
                />
              ))}
            </View>
            {/* The answer is for an IMEI: no chip takes a tap until there is one to check. */}
            <View style={{ opacity: canKym ? 1 : 0.45, pointerEvents: canKym ? "auto" : "none" }} accessibilityState={{ disabled: !canKym }}>
              <Segmented
                options={KYM.map((k) => ({ value: k.id as string, label: k.label }))}
                value={form.kym}
                onChange={(v) => {
                  if (canKym) set({ kym: v as LockForm["kym"] });
                }}
              />
            </View>
            {flagged ? <Banner tone="bad" title="Do not take it — return it to the customer." /> : null}
            <Field label="Reference (optional)" value={form.kymRef} onChangeText={(t) => set({ kymRef: t.slice(0, 80) })} placeholder="e.g. time of the SMS reply" />
          </Card>

          {/* 5 · the hand-over ticks — white rows on the grey, so each reads as a tap target */}
          <View style={{ gap: 10 }}>
            <Label style={{ paddingHorizontal: 4 }}>Before you take the phone</Label>
            {lockTicks(head).map((t) => {
              const on = t.key === "storageSeen" ? form.storageSeen : t.key === "imeiCheckAck" ? form.imeiCheckAck : form.checks[t.key];
              return (
                <Option
                  key={t.key}
                  title={t.label}
                  selected={on}
                  onPress={() => {
                    if (t.key === "storageSeen") set({ storageSeen: !on });
                    else if (t.key === "imeiCheckAck") set({ imeiCheckAck: !on });
                    else set({ checks: { ...form.checks, [t.key]: !on } });
                  }}
                />
              );
            })}
          </View>

          {/* 6 · a refusal in the server's words (its blockers are the pill's caption, always in view) */}
          {err ? (
            <Banner tone="bad" title="Not taken">
              {err}
            </Banner>
          ) : null}
        </ScrollView>

        {/* 7 · the pill */}
        <View style={[column, { paddingHorizontal: pad, paddingTop: 8, paddingBottom: 14, gap: 8 }]}>
          {caption ? <Text style={{ color: L.muted, fontSize: 15, lineHeight: 21, textAlign: "center" }}>{caption}</Text> : null}
          <Btn
            title={total !== null ? `Take the trade-in · ${inr(total)}` : "Take the trade-in"}
            big
            busy={locking}
            disabled={!!problem || !!blocker || imeiBusy}
            onPress={() => void lock(head, form)}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * The phone's box, through this tablet's camera (native only — hidden in the browser). A box
 * label carries several Code 128 barcodes (IMEI 1, IMEI 2, serial, EAN): only a 15-digit code
 * that passes the IMEI check digit is taken; anything else says so and keeps looking.
 */
function BoxScanner({ onImei, onStop }: { onImei: (imei: string) => void; onStop: () => void }) {
  const [perm, requestPerm] = useCameraPermissions();
  const [note, setNote] = useState<string | null>(null);
  const handled = useRef(false);
  // Ask once per scan: a "deny" must not bring the prompt straight back.
  const asked = useRef(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!perm || perm.granted || !perm.canAskAgain || asked.current) return;
    asked.current = true;
    setAsking(true);
    requestPerm()
      .catch(() => null)
      .finally(() => setAsking(false));
  }, [perm, requestPerm]);

  if (!perm || asking || (!perm.granted && perm.canAskAgain && !asked.current)) return <Body muted>Opening the camera…</Body>;
  if (!perm.granted) {
    return (
      <View style={{ gap: 10 }}>
        <Notice tone="warn">The camera is needed to scan the box. Type the IMEI instead, or allow the camera in the tablet's Settings.</Notice>
        <Btn title="Type it instead" kind="ghost" onPress={onStop} style={{ alignSelf: "flex-start" }} />
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      <View style={{ height: 240, borderRadius: L.radius, overflow: "hidden", backgroundColor: "#000" }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["code128"] }}
          onBarcodeScanned={({ data }) => {
            if (handled.current) return;
            const d = String(data ?? "").replace(/\D/g, "");
            if (d.length === 15 && imeiCheck(d) === "ok") {
              handled.current = true;
              onImei(d);
              return;
            }
            setNote("That barcode isn't an IMEI. Point at the one labelled IMEI.");
          }}
        />
      </View>
      {note ? <Notice tone="warn">{note}</Notice> : null}
      <Btn title="Stop scanning" kind="ghost" onPress={onStop} style={{ alignSelf: "flex-start" }} />
    </View>
  );
}
