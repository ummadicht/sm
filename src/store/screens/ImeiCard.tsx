// THE IMEI CARD — the first step of a trade-in (owner, 2026-10-19: "Scan IMEI first ... by
// *#06#"). One card, in three places:
//   - New trade-in (./NewTradeIn): before the mobile. It only captures; Start saves it (../imei.ts
//     startTradeIn) — or "Skip — scan at hand-over".
//   - The Session screen (CaseImeiCard below): a test the customer started from the counter QR has
//     no New trade-in, so the same card tops the session and saves at once; after a store-led Start
//     it shows what the server found.
//   - Take the trade-in (./Lock), when the case still has no IMEI: the fallback, as before.
// The customer dials *#06#; the advisor Scans it (native: ./ImeiCamera), has the server Read the
// screen from a photo (shown as "Read: … — confirm", never trusted by itself), or types it (the
// check-digit warning as on Lock). Once saved, the server looks the IMEI up once per case: the
// model, the GSMA blacklist and an IMEI already on another trade-in — and the government check
// (KYM, SMS to 14422) can be sent right away, its answer recorded here for Lock to start from.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Text, View } from "react-native";
import { Notice } from "../../shared/kit";
import { IMEI_READ_MS, IMEI_SAVE_MS, NOTHING_READ, type ImeiRead, type Scanned, imeiPatch, imeiResultLine, imeiStop, readFailText, readImeiRead } from "../imei";
import { KYM, type Kym, kymSends } from "../lock";
import { type CaseHead, readCaseHead } from "../offer";
import { imeiCheck } from "../phoneLed";
import { type StaffClient, errText } from "../staffClient";
import { Banner, Body, Btn, Card, Field, L, Label, Segmented } from "../ui";
import { ImeiCamera } from "./ImeiCamera";

const mono = { fontVariant: ["tabular-nums" as const], letterSpacing: 1 };

/** "IMEI 1 · 356789012345672" (and IMEI 2 under it). */
function ImeiNumbers({ imei, imei2 }: { imei: string; imei2: string | null }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={[{ fontSize: 20, fontWeight: "700", color: L.ink }, mono]}>{`IMEI 1 · ${imei}`}</Text>
      {imei2 ? <Text style={[{ fontSize: 17, fontWeight: "600", color: L.ink }, mono]}>{`IMEI 2 · ${imei2}`}</Text> : null}
    </View>
  );
}

/** What the server found for the IMEI: "Galaxy S23 Ultra · not blacklisted (GSMA)", then its warnings. */
export function ImeiFound({ head }: { head: Pick<CaseHead, "imeiLookup" | "imeiWarnings"> }) {
  const line = imeiResultLine(head.imeiLookup);
  const b = head.imeiLookup?.blacklist;
  return (
    <>
      {line ? <Text style={{ fontSize: 17, fontWeight: "700", lineHeight: 23, color: b === "clean" ? L.up : b === "blacklisted" ? L.bad : L.warn }}>{line}</Text> : null}
      {head.imeiWarnings.map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}
    </>
  );
}

/** The red banner when the trade-in stops here (the owner's sentence); Start / the tests stay off. */
export function ImeiStop({ text }: { text: string | null }) {
  return text ? (
    <Banner tone="bad" title="Do not take it">
      {text}
    </Banner>
  ) : null;
}

/**
 * Capture: Scan · Read the screen · type. `value` is what New trade-in holds until Start (null =
 * nothing yet); on the Session and Lock screens it stays null and `onChange` saves at once.
 */
export function ImeiCapture({
  api,
  value,
  onChange,
  skip,
  busy,
  error,
  children,
}: {
  api: StaffClient;
  value: Scanned | null;
  onChange: (v: Scanned | null) => void;
  /** "Skip — scan at hand-over" (New trade-in, Session), or "Keep the IMEI" while changing one. */
  skip?: { title: string; onPress: () => void };
  /** Saving it. */
  busy?: boolean;
  /** The save's refusal, in the server's words. */
  error?: string | null;
  /** Under the captured IMEI (New trade-in): what the server found. */
  children?: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<ImeiRead | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const take = useCallback(
    (v: Scanned) => {
      setRead(null);
      setNote(null);
      onChange(v);
    },
    [onChange]
  );

  /** POST /api/imei/read: the server has GradeIQ read the photo. The answer waits for the advisor's confirm. */
  async function readPhoto(photo: string) {
    setReading(true);
    setNote(null);
    setRead(null);
    try {
      const r = readImeiRead(await api.post<unknown>("/api/imei/read", { photo }, { timeoutMs: IMEI_READ_MS }));
      if (!alive.current) return;
      if (!r) setNote(NOTHING_READ);
      else if (r.valid) setRead(r);
      else {
        // A misread digit: into the field, for the advisor to put right against the screen.
        setText(r.imei);
        setNote("That read fails its check digit — correct it below.");
      }
    } catch (e) {
      if (alive.current) setNote(readFailText(e));
    } finally {
      if (alive.current) setReading(false);
    }
  }

  function typeImei(t: string) {
    const d = t.replace(/\D/g, "").slice(0, 15);
    setText(d);
    setRead(null);
    // A valid IMEI goes at once — nothing to press.
    if (d.length === 15 && imeiCheck(d) === "ok" && !busy) take({ imei: d, imei2: null });
  }

  if (value?.imei) {
    return (
      <View style={{ gap: 12 }}>
        <Label>IMEI</Label>
        <ImeiNumbers imei={value.imei} imei2={value.imei2} />
        {children}
        <Btn
          title="Change"
          kind="ghost"
          disabled={busy}
          onPress={() => {
            setText("");
            onChange(null);
          }}
          style={{ alignSelf: "flex-start" }}
        />
      </View>
    );
  }

  const typedBad = text.length === 15 && imeiCheck(text) === "bad";
  return (
    <View style={{ gap: 12 }}>
      <Label>IMEI</Label>
      <Body>Customer dials *#06#.</Body>
      <ImeiCamera disabled={busy} reading={reading} onScanned={take} onPhoto={(p) => void readPhoto(p)} onError={setNote} />
      {read ? (
        <View style={{ gap: 10 }}>
          <Notice>{`Read: ${read.imei}${read.imei2 ? ` · IMEI 2 ${read.imei2}` : ""} — check it against the screen.`}</Notice>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Btn title="Confirm" onPress={() => take({ imei: read.imei, imei2: read.imei2 })} disabled={busy} />
            <Btn
              title="Not right"
              kind="ghost"
              onPress={() => {
                setText(read.imei);
                setRead(null);
              }}
            />
          </View>
        </View>
      ) : null}
      {note ? <Notice tone="warn">{note}</Notice> : null}
      <Field
        label="Or type IMEI 1"
        value={text}
        onChangeText={typeImei}
        keyboardType="number-pad"
        inputMode="numeric"
        placeholder="15 digits"
        maxLength={15}
        editable={!busy}
        error={error ?? (typedBad ? "Fails its check digit — re-read *#06#." : null)}
        hint={busy ? "Saving…" : undefined}
        style={{ fontVariant: ["tabular-nums"], letterSpacing: 1.5 }}
      />
      {typedBad && !busy ? (
        // Rare, but real: the server keeps it, and Take the trade-in then asks for the re-read.
        <Btn title="Record it anyway" kind="ghost" onPress={() => take({ imei: text, imei2: null })} style={{ alignSelf: "flex-start" }} />
      ) : null}
      {skip ? <Btn title={skip.title} kind="ghost" onPress={skip.onPress} disabled={busy || reading} style={{ alignSelf: "flex-start" }} /> : null}
    </View>
  );
}

export const SKIP_TITLE = "Skip — scan at hand-over";

/** The card while the IMEI waits for the hand-over: one line, and the way back to it. */
export function ImeiLater({ onScan }: { onScan: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
        <Label>IMEI</Label>
        <Body muted>Skipped — scan it at hand-over.</Body>
      </View>
      <Btn title="Scan now" kind="secondary" onPress={onScan} />
    </View>
  );
}

/**
 * The Session screen's IMEI card, for the case of this test. No IMEI yet: capture, saved at once
 * (PATCH {imei, imei2} — the server looks it up before it answers). With one: the IMEI, what the
 * server found, the stop banner, and the government check (KYM) — the SMS now, its answer recorded
 * as kymEarly (Take the trade-in starts from it, and still needs it "clear").
 */
export function CaseImeiCard({ api, caseId, skipped: skippedAtStart }: { api: StaffClient; caseId: string; skipped?: boolean }) {
  const path = `/api/cases/${encodeURIComponent(caseId)}`;
  const [head, setHead] = useState<CaseHead | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(!!skippedAtStart);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [kymBusy, setKymBusy] = useState(false);
  const [kymErr, setKymErr] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const h = readCaseHead(await api.get<unknown>(path));
      if (!h) throw new Error("Bad answer from the server.");
      if (alive.current) setHead(h);
    } catch (e) {
      if (alive.current) setLoadErr(errText(e));
    }
  }, [api, path]);
  useEffect(() => {
    void load();
  }, [load]);

  // "Change IMEI" to another phone's number clears the old IMEI 2 (../imei.ts imeiPatch).
  const caseImei = head?.imei ?? null;
  const save = useCallback(
    async (v: Scanned | null) => {
      if (!v?.imei) return;
      setSaveErr(null);
      setSaving(true);
      try {
        const h = readCaseHead(await api.patch<unknown>(path, imeiPatch({ imei: v.imei, imei2: v.imei2 }, caseImei), { timeoutMs: IMEI_SAVE_MS }));
        if (!h) throw new Error("Bad answer from the server.");
        if (!alive.current) return;
        setHead(h);
        setEditing(false);
      } catch (e) {
        if (alive.current) setSaveErr(errText(e));
      } finally {
        if (alive.current) setSaving(false);
      }
    },
    [api, path, caseImei]
  );

  async function saveKym(status: Kym) {
    setKymErr(null);
    setKymBusy(true);
    try {
      const h = readCaseHead(await api.patch<unknown>(path, { kymEarly: { status, reference: head?.kymEarly?.reference ?? null } }));
      if (h && alive.current) setHead(h);
    } catch (e) {
      if (alive.current) setKymErr(errText(e));
    } finally {
      if (alive.current) setKymBusy(false);
    }
  }

  if (!head) {
    return loadErr ? (
      <Card>
        <Banner tone="warn" title="Couldn't load the IMEI" action={{ title: "Try again", onPress: () => void load() }}>
          {loadErr}
        </Banner>
      </Card>
    ) : null;
  }

  if (head.imei && !editing) {
    return (
      <Card style={{ gap: 12 }}>
        <Label>IMEI</Label>
        <ImeiNumbers imei={head.imei} imei2={head.imei2} />
        <ImeiFound head={head} />
        <ImeiStop text={imeiStop(head)} />
        <View style={{ gap: 10 }}>
          <Body muted>Government IMEI check (KYM):</Body>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {kymSends(head).map((b) => (
              <Btn
                key={b.title}
                title={b.title}
                kind="secondary"
                disabled={b.disabled}
                onPress={() => {
                  Linking.openURL(b.uri).catch(() => setKymErr("No SMS app here — use the store phone."));
                }}
              />
            ))}
          </View>
          <Segmented
            options={KYM.map((k) => ({ value: k.id as string, label: k.label }))}
            value={head.kymEarly?.status ?? ""}
            onChange={(v) => void saveKym(v as Kym)}
            disabled={kymBusy}
          />
          {kymErr ? <Notice tone="warn">{kymErr}</Notice> : null}
        </View>
        <Btn title="Change IMEI" kind="ghost" onPress={() => setEditing(true)} style={{ alignSelf: "flex-start" }} />
      </Card>
    );
  }

  if (skipped && !head.imei) {
    return (
      <Card>
        <ImeiLater onScan={() => setSkipped(false)} />
      </Card>
    );
  }

  return (
    <Card>
      <ImeiCapture
        api={api}
        value={null}
        onChange={(v) => void save(v)}
        skip={head.imei ? { title: "Keep the IMEI", onPress: () => setEditing(false) } : { title: SKIP_TITLE, onPress: () => setSkipped(true) }}
        busy={saving}
        error={saveErr}
      />
    </Card>
  );
}
