// Identify — the first step after joining, native and browser alike
// (swapup docs/PHONE-LED-FLOW.md §2, after GradeIQ v2's identify step):
//   1. "Let's check this phone." — the model the store matched from the phone's
//      own model code (the join response's `identity`): "Yes, that's my phone" /
//      "No — choose my phone".
//   2. No match, or "No" → choose it: brand → model (search past 12) → storage,
//      from GET /api/device/models. The answer is a CLAIM ("customer picked"),
//      never a match — the store decides what the phone is.
//   3. The IMEI: "Dial *#06#" (an app can't read it on Android 10+), IMEI 1 and
//      an optional IMEI 2, each with its check digit shown; a bad check digit
//      blocks Continue, Skip never is.
//   4. Customer-started checks only (the store's counter code — no advisor has
//      typed anything yet): mobile number and name, both optional.
// Everything goes to the store as one declaration (engine.identify).
//
// Unlike GradeIQ's picker it keeps the model id it picked, offers the manual
// route even when the phone was recognised, and an older server (no model list,
// no identity) just leaves the model to the advisor instead of dead-ending.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { T } from "../shared/theme";
import { IS_WEB } from "../shared/config";
import { Big, Say } from "../diagnostics/parts";
import { Kicker, Note, Screen, Title } from "./screens";
import {
  MODEL_SEARCH_FROM,
  checkImei,
  cleanMobile,
  cleanName,
  filterModels,
  identityLine,
  imeisFromText,
  parseBrands,
  parseModels,
  type CheckState,
  type ImeiCheck,
  type ModelRef,
} from "./core";
import type { CheckEngine, IdentifyAnswers } from "./engine";
import { onIphone } from "./onIphone";

type Stage = "confirm" | "brand" | "model" | "storage" | "imei" | "you";
/** none = this store's system has no model list (an older server) — the advisor chooses the model. */
type Load = "loading" | "ready" | "error" | "none";

export function IdentifyScreen({
  engine,
  state,
  onDone,
  onWrongCode,
}: {
  engine: CheckEngine;
  state: CheckState;
  onDone: (a: IdentifyAnswers) => void;
  onWrongCode: () => void;
}) {
  const identity = state.session.identity ?? null;
  const known = !!identity && identity.match !== "none" && !!identity.label;
  const code = state.reported?.modelCode ?? null;
  const [ios] = useState(onIphone);

  const [stage, setStage] = useState<Stage>(known ? "confirm" : "brand");
  /** null = there was nothing to confirm (no match). */
  const [confirmed, setConfirmed] = useState<boolean | null>(null);

  // ── the picker
  const [attempt, setAttempt] = useState(0);
  const [brands, setBrands] = useState<string[]>([]);
  const [brandsLoad, setBrandsLoad] = useState<Load>("loading");
  const [brand, setBrand] = useState<string | null>(null);
  const [models, setModels] = useState<ModelRef[]>([]);
  const [modelsLoad, setModelsLoad] = useState<Load>("loading");
  const [model, setModel] = useState<ModelRef | null>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // ── IMEI + contact
  const [imei1, setImei1] = useState(state.declared?.imei ?? "");
  const [imei2, setImei2] = useState(state.declared?.imei2 ?? "");
  const [imeiNote, setImeiNote] = useState<string | null>(null);
  const [mobile, setMobile] = useState(state.declared?.customerPhone ?? "");
  const [name, setName] = useState(state.declared?.customerName ?? "");

  const picking = stage === "brand" || stage === "model" || stage === "storage";

  /** A 404 (or an answer we can't read) means this server has no list; network trouble can be retried. */
  const loadState = (status: number): Load => (status === 0 || status >= 500 || status === 429 ? "error" : "none");

  useEffect(() => {
    if (!picking) return;
    let alive = true;
    setBrandsLoad("loading");
    void engine.deviceModels().then((r) => {
      if (!alive) return;
      if (!r.ok) return setBrandsLoad(loadState(r.status));
      const list = parseBrands(r.body);
      setBrands(list ?? []);
      setBrandsLoad(list && list.length ? "ready" : "none");
    });
    return () => {
      alive = false;
    };
    // Loaded once per visit to the picker (and on "Try again").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, picking, attempt]);

  useEffect(() => {
    if (!picking || !brand) return;
    let alive = true;
    setModelsLoad("loading");
    void engine.deviceModels(brand).then((r) => {
      if (!alive) return;
      if (!r.ok) return setModelsLoad(loadState(r.status));
      const list = parseModels(r.body);
      setModels(list ?? []);
      setModelsLoad(list && list.length ? "ready" : "none");
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, picking, brand, attempt]);

  const go = (next: Stage) => {
    setStage(next);
    setQuery(""); // a stale search would hide the list you just came back to
  };

  const finish = (over: Partial<IdentifyAnswers> = {}) => {
    const a = checkImei(imei1);
    const b = checkImei(imei2);
    const phone = cleanMobile(mobile);
    onDone({
      imei: a.ok === true ? a.imei : null,
      imei2: b.ok === true && !(a.ok === true && a.imei === b.imei) ? b.imei : null,
      identityConfirmed: confirmed,
      picked: model ? { modelId: model.id, variant } : null,
      customerName: state.session.customerStarted ? cleanName(name) : null,
      customerPhone: state.session.customerStarted && phone.ok ? phone.value : null,
      ...over,
    });
  };
  const afterImei = () => (state.session.customerStarted ? go("you") : finish());

  /* ─────────── 1. is this your phone? ─────────── */
  if (stage === "confirm" && identity?.label) {
    return (
      <Screen>
        <Kicker>{state.session.storeName}</Kicker>
        <Title>Let&apos;s check this phone.</Title>
        <View style={s.card}>
          <Text style={s.cardTitle}>{identityLine(identity.label, identity.variant)}</Text>
          {code ? <Text style={s.cardSub}>Your phone calls itself {code}</Text> : null}
        </View>
        <Big
          title="Yes, that's my phone"
          onPress={() => {
            setConfirmed(true);
            setModel(null);
            go("imei");
          }}
        />
        <View style={{ height: 10 }} />
        <Big
          title="No — choose my phone"
          kind="secondary"
          onPress={() => {
            setConfirmed(false);
            go("brand");
          }}
        />
        <View style={{ height: 18 }} />
        <Big title="Wrong store? Use another code" kind="quiet" onPress={onWrongCode} />
        <Text style={s.ref}>Trade-in {state.session.caseRef}</Text>
      </Screen>
    );
  }

  /* ─────────── 2. choose it ─────────── */
  if (picking) {
    const load = stage === "brand" ? brandsLoad : modelsLoad;
    const shown = filterModels(models, query);
    const crumbs: { stage: Stage; value: string }[] = [];
    if (brand && stage !== "brand") crumbs.push({ stage: "brand", value: brand });
    if (model && stage === "storage") crumbs.push({ stage: "model", value: model.model });
    const ready = !!model && (model.variants.length === 0 || !!variant);
    const leave = () => {
      setModel(null);
      setVariant(null);
      go("imei");
    };
    return (
      <Screen>
        <Kicker>{state.session.storeName}</Kicker>
        <Title>{stage === "brand" ? "Which phone is this?" : stage === "model" ? `Which ${brand}?` : "How much storage?"}</Title>
        {stage === "brand" && !known ? (
          <View style={{ marginBottom: 14 }}>
            <Note>{code ? `We couldn't tell the exact model from its code (${code}). Choose it here.` : "We couldn't tell the exact model. Choose it here."}</Note>
          </View>
        ) : null}
        {stage === "storage" ? <Say muted>Settings › About phone shows the storage, if you&apos;re not sure.</Say> : null}
        {crumbs.length ? (
          <View style={s.crumbs}>
            {crumbs.map((c) => (
              <Pressable key={c.stage} onPress={() => go(c.stage)} accessibilityRole="button" accessibilityLabel={`Change ${c.value}`} style={s.crumb}>
                <Text style={s.crumbText}>{c.value} ✎</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {load === "loading" ? (
          <ActivityIndicator color={T.accent} size="large" style={{ marginVertical: 28 }} />
        ) : load === "error" ? (
          <View style={{ gap: 10, marginTop: 8 }}>
            <Note tone="warn">Couldn&apos;t load the list of phones — check the Wi‑Fi.</Note>
            <Big title="Try again" kind="secondary" onPress={() => setAttempt((n) => n + 1)} />
          </View>
        ) : load === "none" ? (
          <View style={{ gap: 10, marginTop: 8 }}>
            <Note>The advisor will choose the model on their tablet.</Note>
            <Big title="Continue" onPress={leave} />
          </View>
        ) : stage === "brand" ? (
          <View style={s.list}>
            {brands.map((b) => (
              <Option
                key={b}
                title={b}
                selected={brand === b}
                onPress={() => {
                  // A different brand invalidates the model chosen under the old one.
                  if (brand !== b) {
                    setModel(null);
                    setVariant(null);
                    setModels([]);
                  }
                  setBrand(b);
                  go("model");
                }}
              />
            ))}
          </View>
        ) : stage === "model" ? (
          <View style={s.list}>
            {models.length > MODEL_SEARCH_FROM ? (
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={`Search ${brand} models`}
                placeholderTextColor={T.skip}
                autoCorrect={false}
                style={s.input}
                accessibilityLabel={`Search ${brand} models`}
              />
            ) : null}
            {shown.map((m) => (
              <Option
                key={m.id}
                title={m.model}
                selected={model?.id === m.id}
                onPress={() => {
                  if (model?.id !== m.id) setVariant(null);
                  setModel(m);
                  if (m.variants.length) go("storage");
                }}
              />
            ))}
            {!shown.length ? (
              <View style={{ alignItems: "center", paddingVertical: 16, gap: 8 }}>
                <Say muted center>No models match “{query.trim()}”.</Say>
                <Big title="Clear the search" kind="quiet" onPress={() => setQuery("")} />
              </View>
            ) : null}
          </View>
        ) : (
          <View style={s.list}>
            {(model?.variants ?? []).map((v) => (
              <Option key={v} title={v} selected={variant === v} onPress={() => setVariant(v)} />
            ))}
          </View>
        )}

        {load === "ready" && stage !== "brand" ? (
          <>
            <View style={{ height: 18 }} />
            <Big title="Confirm phone" onPress={() => go("imei")} disabled={!ready} />
          </>
        ) : null}
        <View style={{ height: 14 }} />
        <Big title="Leave it to the advisor" kind="quiet" onPress={leave} />
        {known && stage === "brand" ? (
          <Big
            title={`It is the ${identity?.label} after all`}
            kind="quiet"
            onPress={() => {
              setConfirmed(true);
              setModel(null);
              go("imei");
            }}
          />
        ) : null}
        {!known && stage === "brand" ? <Big title="Wrong store? Use another code" kind="quiet" onPress={onWrongCode} /> : null}
      </Screen>
    );
  }

  /* ─────────── 3. the IMEI ─────────── */
  if (stage === "imei") {
    const a = checkImei(imei1);
    const b = checkImei(imei2);
    const same = a.ok === true && b.ok === true && a.imei === b.imei;
    const blocked = a.ok === false || b.ok === false || same;
    const paste = async () => {
      setImeiNote(null);
      try {
        const found = imeisFromText(await Clipboard.getStringAsync());
        if (!found.length) return setImeiNote("There's no IMEI on the clipboard. Copy the number first, or type it.");
        setImei1(found[0]);
        if (found[1]) setImei2(found[1]);
      } catch {
        setImeiNote("Couldn't read the clipboard here — type the digits instead.");
      }
    };
    return (
      <Screen>
        <Kicker>{state.session.storeName}</Kicker>
        <Title>Your phone&apos;s IMEI</Title>
        <Say>Dial *#06# — your phone shows its IMEI. Type the 15 digits here, or copy them and tap Paste.</Say>
        {ios ? <Say muted>On an iPhone, Settings › General › About shows it too.</Say> : null}
        <View style={s.row}>
          {!ios && (Platform.OS === "android" || IS_WEB) ? (
            <Big
              title="Open dialler"
              kind="secondary"
              style={{ flex: 1 }}
              onPress={() => {
                setImeiNote(null);
                Linking.openURL("tel:*%2306%23").catch(() => setImeiNote("Couldn't open the dialler — open the Phone app and dial *#06#."));
              }}
            />
          ) : null}
          <Big title="Paste" kind="secondary" style={{ flex: 1 }} onPress={() => void paste()} />
        </View>
        {imeiNote ? (
          <View style={{ marginTop: 10 }}>
            <Note tone="warn">{imeiNote}</Note>
          </View>
        ) : null}
        <Text style={[s.label, { marginTop: 20 }]}>IMEI 1</Text>
        <ImeiField value={imei1} onChange={setImei1} label="IMEI 1" />
        <ImeiPill check={a} />
        <Text style={[s.label, { marginTop: 16 }]}>IMEI 2 (optional — phones with two SIMs)</Text>
        <ImeiField value={imei2} onChange={setImei2} label="IMEI 2" />
        {same ? <Text style={[s.pill, { color: T.fail }]}>That&apos;s the same number as IMEI 1 — IMEI 2 is the other one shown.</Text> : <ImeiPill check={b} />}
        <View style={{ height: 22 }} />
        <Big title="Continue" onPress={afterImei} disabled={blocked || a.ok !== true} />
        {a.ok !== true && !blocked ? <Text style={s.ref}>Type IMEI 1 to continue, or skip it.</Text> : null}
        <View style={{ height: 8 }} />
        <Big
          title="Skip — the advisor will scan it"
          kind="quiet"
          onPress={() => {
            setImei1("");
            setImei2("");
            if (state.session.customerStarted) go("you");
            else finish({ imei: null, imei2: null });
          }}
        />
      </Screen>
    );
  }

  /* ─────────── 4. you (customer-started checks) ─────────── */
  const phone = cleanMobile(mobile);
  return (
    <Screen>
      <Kicker>{state.session.storeName}</Kicker>
      <Title>So the store can find your trade-in</Title>
      <Say muted>Both are optional. They stay with this store.</Say>
      <Text style={[s.label, { marginTop: 20 }]}>Your mobile number</Text>
      <TextInput
        value={mobile}
        onChangeText={(t) => setMobile(t.replace(/[^\d+\s-]/g, "").slice(0, 16))}
        keyboardType="phone-pad"
        placeholder="10 digits"
        placeholderTextColor={T.skip}
        style={s.input}
        accessibilityLabel="Your mobile number"
      />
      {phone.ok === false ? <Text style={[s.pill, { color: T.fail }]}>{phone.message}</Text> : null}
      <Text style={[s.label, { marginTop: 16 }]}>Your name</Text>
      <TextInput value={name} onChangeText={(t) => setName(t.slice(0, 80))} autoCapitalize="words" placeholder="Name" placeholderTextColor={T.skip} style={s.input} accessibilityLabel="Your name" />
      <View style={{ height: 22 }} />
      <Big title="Continue" onPress={() => finish()} disabled={phone.ok === false} />
      <View style={{ height: 8 }} />
      <Big title="Skip" kind="quiet" onPress={() => finish({ customerName: null, customerPhone: null })} />
    </Screen>
  );
}

function ImeiField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <TextInput
      value={value}
      onChangeText={(t) => onChange(t.replace(/\D/g, "").slice(0, 15))}
      keyboardType="number-pad"
      placeholder="15 digits"
      placeholderTextColor={T.skip}
      style={[s.input, s.imei]}
      accessibilityLabel={label}
    />
  );
}

/** "✓ Check digit OK", or what is wrong with the number — under each field as it is typed. */
function ImeiPill({ check }: { check: ImeiCheck }) {
  if (check.ok === null) return null;
  if (check.ok) return <Text style={[s.pill, { color: T.pass }]}>✓ Check digit OK</Text>;
  return <Text style={[s.pill, { color: T.fail }]}>{check.message}</Text>;
}

function Option({ title, selected, onPress }: { title: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [s.option, selected && { borderColor: T.accent, backgroundColor: T.surface2 }, pressed && { opacity: 0.75 }]}
    >
      <Text style={s.optionText}>{title}</Text>
      {selected ? <Text style={[s.optionText, { color: T.accent }]}>✓</Text> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.border, padding: 18, marginBottom: 22, gap: 6 },
  cardTitle: { color: T.text, fontSize: 24, fontWeight: "800", lineHeight: 30 },
  cardSub: { color: T.muted, fontSize: 16 },
  crumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  crumb: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: T.accent, backgroundColor: T.surface2 },
  crumbText: { color: T.accent, fontSize: 15, fontWeight: "700" },
  list: { gap: 10 },
  option: { minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, borderRadius: T.radius, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface },
  optionText: { color: T.text, fontSize: 18, fontWeight: "700" },
  row: { flexDirection: "row", gap: 10, marginTop: 16 },
  label: { color: T.text, fontSize: 16, fontWeight: "700", marginBottom: 8 },
  input: { backgroundColor: T.surface, borderColor: T.border, borderWidth: 1, borderRadius: T.radius, color: T.text, fontSize: 18, paddingVertical: 14, paddingHorizontal: 14 },
  imei: { fontSize: 22, fontWeight: "800", letterSpacing: 2, textAlign: "center" },
  pill: { fontSize: 15, lineHeight: 21, fontWeight: "700", marginTop: 8 },
  ref: { color: T.muted, fontSize: 14, textAlign: "center", marginTop: 10 },
});
