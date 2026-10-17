// Identify — the first step after joining, native and browser alike
// (swapup docs/PHONE-LED-FLOW.md §2, after GradeIQ v2's identify step):
//   1. "Let's check this phone." — the model the store matched from the phone's
//      own model code (the join response's `identity`): "Yes, that's my phone" /
//      "No — choose my phone". When the phone couldn't measure its storage and
//      the model comes in more than one size, the same card asks "How much
//      storage?" (confirmStorage); "Not sure" leaves it to the advisor. The
//      pick is a CLAIM — a measured size always wins on the server.
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
// Look: the SWAPUP EXPERIENCE CENTER kit — the wordmark on the first of these
// screens only, then one headline, one sentence, the choices, one pill button.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { P } from "../shared/theme";
import { IS_WEB } from "../shared/config";
import { Caption, Chip, DialKeysArt, Field, Headline, Hero, Label, Lead, Notice, Option, PhoneArt, PillButton, QuietLink, Screen, Wordmark } from "../shared/kit";
import {
  MODEL_SEARCH_FROM,
  checkImei,
  cleanMobile,
  cleanName,
  confirmStorage,
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
  // ── the confirm card's storage question (kept apart from the picker's model + variant)
  const storage = confirmStorage(identity);
  const [confirmVariant, setConfirmVariant] = useState<string | null>(null);

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
    // The size picked on the confirm card goes only with "Yes, that's my phone" — after a
    // "No" the matched model is not the customer's answer, so it is never sent back as one.
    const sized =
      confirmed === true && identity?.modelId && confirmVariant && storage.options.includes(confirmVariant)
        ? { modelId: identity.modelId, variant: confirmVariant }
        : null;
    onDone({
      imei: a.ok === true ? a.imei : null,
      imei2: b.ok === true && !(a.ok === true && a.imei === b.imei) ? b.imei : null,
      identityConfirmed: confirmed,
      picked: model ? { modelId: model.id, variant } : sized,
      customerName: state.session.customerStarted ? cleanName(name) : null,
      customerPhone: state.session.customerStarted && phone.ok ? phone.value : null,
      ...over,
    });
  };
  const afterImei = () => (state.session.customerStarted ? go("you") : finish());

  /** The first screen after joining carries the wordmark and the store's name. */
  const entry: Stage = known ? "confirm" : "brand";

  /* ─────────── 1. is this your phone? ─────────── */
  if (stage === "confirm" && identity?.label) {
    const yes = (size: string | null) => {
      setConfirmed(true);
      setModel(null);
      setConfirmVariant(size);
      go("imei");
    };
    return (
      <Screen
        footer={
          <>
            <PillButton title="Yes, that's my phone" onPress={() => yes(confirmVariant)} disabled={storage.ask && !confirmVariant} />
            <PillButton
              title="No — choose my phone"
              kind="outline"
              arrow={false}
              onPress={() => {
                setConfirmed(false);
                setConfirmVariant(null);
                go("brand");
              }}
            />
            <QuietLink title="Wrong store? Use another code" onPress={onWrongCode} />
          </>
        }
      >
        <Wordmark store={state.session.storeName} />
        <Headline>Let&apos;s check this phone.</Headline>
        <Lead>Is this the right model?</Lead>
        {/* With the storage question below it, the phone shrinks so the sizes stay above the buttons. */}
        <Hero minHeight={storage.ask ? 0 : 220} grow={!storage.ask} style={storage.ask ? { paddingVertical: 16 } : undefined}>
          <PhoneArt width={storage.ask ? 56 : 84} />
          <Text style={s.model}>{identityLine(identity.label, identity.variant)}</Text>
          {code ? <Caption style={{ marginTop: 4 }}>Your phone calls itself {code}</Caption> : null}
        </Hero>
        {storage.ask ? (
          <View style={s.list}>
            <Label style={{ marginBottom: 0 }}>How much storage?</Label>
            {storage.options.map((v) => (
              <Option key={v} title={v} selected={confirmVariant === v} onPress={() => setConfirmVariant(v)} />
            ))}
            <Caption style={{ marginTop: 0 }}>Settings › About phone shows it.</Caption>
            <QuietLink title="Not sure — the advisor will check" onPress={() => yes(null)} />
          </View>
        ) : null}
        <Caption>Trade-in {state.session.caseRef}</Caption>
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
    const lead =
      stage === "brand" && !known
        ? code
          ? `We couldn't tell the exact model from its code (${code}). Choose it here.`
          : "We couldn't tell the exact model. Choose it here."
        : stage === "storage"
          ? "Settings › About phone shows the storage, if you're not sure."
          : null;
    return (
      <Screen
        footer={
          <>
            {load === "none" ? (
              <PillButton title="Continue" onPress={leave} />
            ) : load === "ready" && stage !== "brand" ? (
              <PillButton title="Confirm phone" onPress={() => go("imei")} disabled={!ready} />
            ) : null}
            {load !== "none" ? (
              stage === "brand" ? (
                <PillButton title="Leave it to the advisor" kind="outline" arrow={false} onPress={leave} />
              ) : (
                <QuietLink title="Leave it to the advisor" onPress={leave} />
              )
            ) : null}
            {known && stage === "brand" ? (
              <QuietLink
                title={`It is the ${identity?.label} after all`}
                onPress={() => {
                  // Back to the confirm card when its storage question still needs an answer.
                  if (storage.ask) return go("confirm");
                  setConfirmed(true);
                  setModel(null);
                  go("imei");
                }}
              />
            ) : null}
            {!known && stage === "brand" ? <QuietLink title="Wrong store? Use another code" onPress={onWrongCode} /> : null}
          </>
        }
      >
        {stage === entry ? <Wordmark store={state.session.storeName} /> : null}
        <Headline>{stage === "brand" ? "Which phone is this?" : stage === "model" ? `Which ${brand}?` : "How much storage?"}</Headline>
        {lead ? <Lead>{lead}</Lead> : null}
        {crumbs.length ? (
          <View style={s.crumbs}>
            {crumbs.map((c) => (
              <Chip key={c.stage} title={`${c.value} ✎`} accessibilityLabel={`Change ${c.value}`} onPress={() => go(c.stage)} />
            ))}
          </View>
        ) : null}
        <View style={{ height: 22 }} />

        {load === "loading" ? (
          <ActivityIndicator color={P.primary} size="large" style={{ marginVertical: 28 }} />
        ) : load === "error" ? (
          <View style={{ gap: 12 }}>
            <Notice tone="warn">Couldn&apos;t load the list of phones — check the Wi‑Fi.</Notice>
            <PillButton title="Try again" kind="outline" size="sm" onPress={() => setAttempt((n) => n + 1)} style={{ alignSelf: "flex-start" }} />
          </View>
        ) : load === "none" ? (
          <Notice>The advisor will choose the model on their tablet.</Notice>
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
              <Field value={query} onChangeText={setQuery} placeholder={`Search ${brand} models`} autoCorrect={false} accessibilityLabel={`Search ${brand} models`} />
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
              <View style={{ alignItems: "center", paddingVertical: 16, gap: 4 }}>
                <Caption style={{ marginTop: 0 }}>No models match “{query.trim()}”.</Caption>
                <QuietLink title="Clear the search" onPress={() => setQuery("")} />
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
      <Screen
        footer={
          <>
            <PillButton title="Continue" onPress={afterImei} disabled={blocked || a.ok !== true} />
            {a.ok !== true && !blocked ? <Caption style={{ marginTop: 0 }}>Type IMEI 1 to continue, or skip it.</Caption> : null}
            <QuietLink
              title="Skip — the advisor will scan it"
              onPress={() => {
                setImei1("");
                setImei2("");
                if (state.session.customerStarted) go("you");
                else finish({ imei: null, imei2: null });
              }}
            />
          </>
        }
      >
        <Headline>Your phone&apos;s IMEI</Headline>
        <Lead>Dial *#06# — your phone shows its IMEI. Type the 15 digits here, or copy them and tap Paste.</Lead>
        {ios ? (
          <Caption center={false} style={{ marginTop: 6 }}>
            On an iPhone, Settings › General › About shows it too.
          </Caption>
        ) : null}
        <Hero grow={false} minHeight={0} style={{ paddingVertical: 24 }}>
          <DialKeysArt width={220} />
        </Hero>
        <View style={s.row}>
          {!ios && (Platform.OS === "android" || IS_WEB) ? (
            <PillButton
              title="Open dialler"
              kind="outline"
              size="sm"
              style={{ flex: 1 }}
              onPress={() => {
                setImeiNote(null);
                Linking.openURL("tel:*%2306%23").catch(() => setImeiNote("Couldn't open the dialler — open the Phone app and dial *#06#."));
              }}
            />
          ) : null}
          <PillButton title="Paste" kind="outline" size="sm" style={{ flex: 1 }} onPress={() => void paste()} />
        </View>
        {imeiNote ? (
          <Notice tone="warn" style={{ marginTop: 12 }}>
            {imeiNote}
          </Notice>
        ) : null}
        <Label style={{ marginTop: 24 }}>IMEI 1</Label>
        <ImeiField value={imei1} onChange={setImei1} label="IMEI 1" />
        <ImeiPill check={a} />
        <Label style={{ marginTop: 18 }}>IMEI 2 (optional — phones with two SIMs)</Label>
        <ImeiField value={imei2} onChange={setImei2} label="IMEI 2" />
        {same ? <Text style={[s.pill, { color: P.fail }]}>That&apos;s the same number as IMEI 1 — IMEI 2 is the other one shown.</Text> : <ImeiPill check={b} />}
      </Screen>
    );
  }

  /* ─────────── 4. you (customer-started checks) ─────────── */
  const phone = cleanMobile(mobile);
  return (
    <Screen
      footer={
        <>
          <PillButton title="Continue" onPress={() => finish()} disabled={phone.ok === false} />
          <QuietLink title="Skip" onPress={() => finish({ customerName: null, customerPhone: null })} />
        </>
      }
    >
      <Headline>So the store can find your trade-in</Headline>
      <Lead>Both are optional. They stay with this store.</Lead>
      <Label style={{ marginTop: 28 }}>Your mobile number</Label>
      <Field
        value={mobile}
        onChangeText={(t) => setMobile(t.replace(/[^\d+\s-]/g, "").slice(0, 16))}
        keyboardType="phone-pad"
        placeholder="10 digits"
        accessibilityLabel="Your mobile number"
      />
      {phone.ok === false ? <Text style={[s.pill, { color: P.fail }]}>{phone.message}</Text> : null}
      <Label style={{ marginTop: 18 }}>Your name</Label>
      <Field value={name} onChangeText={(t) => setName(t.slice(0, 80))} autoCapitalize="words" placeholder="Name" accessibilityLabel="Your name" />
    </Screen>
  );
}

function ImeiField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Field
      big="digits"
      value={value}
      onChangeText={(t) => onChange(t.replace(/\D/g, "").slice(0, 15))}
      keyboardType="number-pad"
      placeholder="15 digits"
      accessibilityLabel={label}
    />
  );
}

/** "✓ Check digit OK", or what is wrong with the number — under each field as it is typed. */
function ImeiPill({ check }: { check: ImeiCheck }) {
  if (check.ok === null) return null;
  if (check.ok) return <Text style={[s.pill, { color: P.pass }]}>✓ Check digit OK</Text>;
  return <Text style={[s.pill, { color: P.fail }]}>{check.message}</Text>;
}

const s = StyleSheet.create({
  model: { color: P.ink, fontSize: 22, fontWeight: "700", lineHeight: 28, textAlign: "center", marginTop: 18 },
  crumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  list: { gap: 10 },
  row: { flexDirection: "row", gap: 10 },
  pill: { fontSize: 15, lineHeight: 21, fontWeight: "600", marginTop: 8 },
});
