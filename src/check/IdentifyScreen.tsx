// Identify — native and browser alike (swapup docs/PHONE-LED-FLOW.md §2), and only for a
// phone the store could not name EXACTLY from its own model code (owner, 2026-10-17: "'Is this
// your phone?' only when the model match is not exact"):
//   - a family match (a regional version of a model on file): "Is this your phone?" — one tap,
//     "Yes, it's mine" / "No — choose it". Storage only when the phone couldn't measure it
//     (core.ts confirmAsk; "Not sure" leaves it to the advisor).
//   - no match: "Which phone is this?" — brand → model (search past 12) → storage, from GET
//     /api/device/models. The answer is a CLAIM ("customer picked"), never a match: the store
//     decides what the phone is. "Ask the advisor" is always there.
// An exact match never sees this screen (core.ts identifyDone), and nothing else is asked here
// (no IMEI — the advisor types or scans it at the trade-in; no name or mobile — the trade-in
// form). A measured storage always wins on the server.
//
// An older server (no model list) just leaves the model to the advisor instead of
// dead-ending. Look: the SWAPUP EXPERIENCE CENTER kit — the wordmark on the first of
// these screens only, then one headline, one sentence, the choices, one pill button.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { P } from "../shared/theme";
import { Caption, Chip, Field, Headline, Hero, Label, Lead, Notice, Option, PhoneArt, PillButton, QuietLink, Screen, Wordmark } from "../shared/kit";
import { MODEL_SEARCH_FROM, confirmAsk, filterModels, parseBrands, parseModels, type CheckState, type ModelRef } from "./core";
import type { CheckEngine, IdentifyAnswers } from "./engine";

type Stage = "confirm" | "brand" | "model" | "storage";
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
  const code = state.reported?.modelCode ?? null;
  // The phone read its own storage: the store takes that over any answer, so it isn't asked.
  const measured = state.reported?.measured === true;

  // A family match: one tap to confirm it (and its storage, only when the phone couldn't measure it).
  const ask = confirmAsk(state.session.identity);
  const [stage, setStage] = useState<Stage>(ask ? "confirm" : "brand");
  /** "No — choose it" on the confirm card: the matched model isn't the customer's. */
  const [declined, setDeclined] = useState(false);
  const [confirmSize, setConfirmSize] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [brands, setBrands] = useState<string[]>([]);
  const [brandsLoad, setBrandsLoad] = useState<Load>("loading");
  const [brand, setBrand] = useState<string | null>(null);
  const [models, setModels] = useState<ModelRef[]>([]);
  const [modelsLoad, setModelsLoad] = useState<Load>("loading");
  const [model, setModel] = useState<ModelRef | null>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  /** A 404 (or an answer we can't read) means this server has no list; network trouble can be retried. */
  const loadState = (status: number): Load => (status === 0 || status >= 500 || status === 429 ? "error" : "none");

  useEffect(() => {
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
    // Loaded once (and on "Try again").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, attempt]);

  useEffect(() => {
    if (!brand) return;
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
  }, [engine, brand, attempt]);

  // Poll status while on IdentifyScreen so if the advisor scans/saves the IMEI on the case
  // after this phone joined (counter code, or "scan at hand-over"), `state.session.identity`
  // updates and advances past the picker by itself (SUP-258).
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await engine.pollStatus();
      if (alive) t = setTimeout(tick, 3000);
    };
    t = setTimeout(tick, 3000);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [engine]);

  // If the server matched a model family from the IMEI before the customer declined or picked a brand, show the confirm card.
  useEffect(() => {
    if (ask && !declined && stage === "brand" && !brand) {
      setStage("confirm");
    }
  }, [ask, declined, stage, brand]);

  const go = (next: Stage) => {
    setStage(next);
    setQuery(""); // a stale search would hide the list you just came back to
  };
  const askSize = (m: ModelRef) => !measured && m.variants.length > 0;
  const confirm = (m: ModelRef, v: string | null) => onDone({ picked: { modelId: m.id, variant: askSize(m) ? v : null }, ...(declined ? { identityConfirmed: false } : {}) });
  const leave = () => onDone(declined ? { identityConfirmed: false } : {});

  /* ─────────── Is this your phone? (a family match) ─────────── */
  if (stage === "confirm" && ask) {
    const yes = (size: string | null) =>
      onDone({ identityConfirmed: true, picked: size && ask.modelId ? { modelId: ask.modelId, variant: size } : null });
    const sized = ask.sizes.length > 0;
    return (
      <Screen
        footer={
          <>
            <PillButton title="Yes, it's mine" onPress={() => yes(confirmSize)} disabled={sized && !confirmSize} />
            <PillButton
              title="No — choose it"
              kind="outline"
              arrow={false}
              onPress={() => {
                setDeclined(true);
                setConfirmSize(null);
                go("brand");
              }}
            />
            <QuietLink title="Wrong store?" onPress={onWrongCode} />
          </>
        }
      >
        <Wordmark store={state.session.storeName} />
        <Headline>Is this your phone?</Headline>
        {/* With the storage question below it, the phone shrinks so the sizes stay above the buttons. */}
        <Hero minHeight={sized ? 0 : 200} grow={!sized} style={sized ? { paddingVertical: 16 } : undefined}>
          <PhoneArt width={sized ? 56 : 84} />
          <Text style={s.model}>{ask.label}</Text>
          {code ? <Caption style={{ marginTop: 4 }}>Your phone calls itself {code}</Caption> : null}
        </Hero>
        {sized ? (
          <View style={s.list}>
            <Label style={{ marginBottom: 0 }}>How much storage?</Label>
            {ask.sizes.map((v) => (
              <Option key={v} title={v} selected={confirmSize === v} onPress={() => setConfirmSize(v)} />
            ))}
            <Caption style={{ marginTop: 0 }}>Settings › About phone shows it.</Caption>
            <QuietLink title="Not sure" onPress={() => yes(null)} />
          </View>
        ) : null}
        <Caption>Trade-in {state.session.caseRef}</Caption>
      </Screen>
    );
  }

  const load = stage === "brand" ? brandsLoad : modelsLoad;
  const shown = filterModels(models, query);
  const crumbs: { stage: Stage; value: string }[] = [];
  if (brand && stage !== "brand") crumbs.push({ stage: "brand", value: brand });
  if (model && stage === "storage") crumbs.push({ stage: "model", value: model.model });
  const ready = !!model && (!askSize(model) || !!variant);
  const lead =
    stage === "brand"
      ? code
        ? `Choose your model (code ${code}).`
        : "Choose your model."
      : stage === "storage"
        ? "Settings › About phone shows it."
        : null;

  return (
    <Screen
      footer={
        <>
          {load === "none" ? (
            <PillButton title="Continue" onPress={leave} />
          ) : load === "ready" && stage !== "brand" ? (
            <PillButton title="Confirm phone" onPress={() => model && confirm(model, variant)} disabled={!ready} />
          ) : null}
          {load !== "none" ? (
            stage === "brand" ? (
              <PillButton title="Ask the advisor" kind="outline" arrow={false} onPress={leave} />
            ) : (
              <QuietLink title="Ask the advisor" onPress={leave} />
            )
          ) : null}
          {stage === "brand" ? <QuietLink title="Wrong store?" onPress={onWrongCode} /> : null}
          {stage === "brand" ? <Caption style={{ marginTop: 0 }}>Trade-in {state.session.caseRef}</Caption> : null}
        </>
      }
    >
      {stage === "brand" && !ask ? <Wordmark store={state.session.storeName} /> : null}
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
          <Notice tone="warn">Couldn&apos;t load phones — check the Wi‑Fi.</Notice>
          <PillButton title="Try again" kind="outline" size="sm" onPress={() => setAttempt((n) => n + 1)} style={{ alignSelf: "flex-start" }} />
        </View>
      ) : load === "none" ? (
        <Notice>The advisor picks the model.</Notice>
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
                if (askSize(m)) go("storage");
              }}
            />
          ))}
          {!shown.length ? (
            <View style={{ alignItems: "center", paddingVertical: 16, gap: 4 }}>
              <Caption style={{ marginTop: 0 }}>No models match “{query.trim()}”.</Caption>
              <QuietLink title="Clear search" onPress={() => setQuery("")} />
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

const s = StyleSheet.create({
  model: { color: P.ink, fontSize: 21, fontWeight: "700", textAlign: "center", marginTop: 14 },
  crumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  list: { gap: 10 },
});
