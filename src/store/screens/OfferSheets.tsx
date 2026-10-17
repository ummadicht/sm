// The answer screen's bottom sheets (./Offer.tsx): the new phone, the refurb quote, the
// cover, the partner's quote typed from the Cashify app, "Customer will repair",
// "Customer walked away", and "Why this answer". Each sends ONE change through the
// screen's write queue (a PATCH or an action) and closes when the server took it; a
// refusal stays in the sheet, in the server's own words, so nothing looks saved that isn't.
// The rules each field checks before Save are the server's (lib/server/cases.ts updateCase).
import React, { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { HelpButton, Notice, Option, PillButton, QuietLink, Sheet } from "../../shared/kit";
import type { Coverage, Offer } from "../offer";
import { type StaffClient, errText } from "../staffClient";
import { Field, L, Label, Segmented, inr } from "../ui";

/** A PATCH /api/cases/<id> through the screen's queue: null = saved, else the server's reason. */
export type SaveFn = (patch: Record<string, unknown>) => Promise<string | null>;
/** A POST /api/cases/<id>/action through the screen's queue. */
export type ActFn = (action: string, extra?: Record<string, unknown>) => Promise<string | null>;

const MAX_RUPEES = 500_000;
/** Typing in a ₹ box: digits only (a pasted "₹ 12,500" becomes "12500"), at most 7. */
const rupeesInput = (t: string) => t.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 7);
const rupees = (t: string): number | null => (t ? Number(t) : null);

function Problem({ text }: { text: string | null }) {
  return text ? <Notice tone="fail" style={{ marginTop: 14 }}>{text}</Notice> : null;
}

// ── new phone ────────────────────────────────────────────────────────────────

type NewDevice = { id: string; brand: string; model: string; series: string; variant: string; price: number };

/** GET /api/catalog/new-devices, read defensively: a row without an id, a model or a price is left out. */
function readDevices(x: unknown): NewDevice[] {
  const list = x && typeof x === "object" ? (x as { devices?: unknown }).devices : null;
  if (!Array.isArray(list)) throw new Error("The server's list of new phones didn't make sense.");
  return list
    .map((d) => {
      const o = d && typeof d === "object" ? (d as Record<string, unknown>) : null;
      if (!o || typeof o.id !== "string" || typeof o.model !== "string" || typeof o.price !== "number" || !Number.isFinite(o.price)) return null;
      return {
        id: o.id,
        brand: typeof o.brand === "string" ? o.brand : "",
        model: o.model,
        series: typeof o.series === "string" ? o.series : "",
        variant: typeof o.variant === "string" ? o.variant : "",
        price: o.price,
      };
    })
    .filter((d): d is NewDevice => !!d);
}

/** The catalogue, once per sign-in (one StaffClient per sign-in). A failure is not kept: the next open tries again. */
const catalogue = new WeakMap<StaffClient, Promise<NewDevice[]>>();
function loadNewDevices(api: StaffClient): Promise<NewDevice[]> {
  let p = catalogue.get(api);
  if (!p) {
    p = api.get<unknown>("/api/catalog/new-devices").then(readDevices);
    p.catch(() => catalogue.delete(api));
    catalogue.set(api, p);
  }
  return p;
}

/** The desk's series order (components/counter/shared.ts SERIES_ORDER), then anything else A–Z. */
const SERIES_ORDER = ["S", "Z", "A", "M", "F"];

export function NewPhoneSheet({
  api,
  visible,
  onClose,
  current,
  oldSeries,
  save,
}: {
  api: StaffClient;
  visible: boolean;
  onClose: () => void;
  /** The new phone on the case now (offer.swap.newPhone). */
  current: Offer["swap"]["newPhone"];
  /** The customer's phone's series ("S", "A"…) — the filter starts there. */
  oldSeries: string | null;
  save: SaveFn;
}) {
  const [list, setList] = useState<NewDevice[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [series, setSeries] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setLoadErr(null);
    setErr(null);
    setSeries(null);
    loadNewDevices(api).then(
      (d) => live && setList(d),
      (e) => live && setLoadErr(errText(e))
    );
    return () => {
      live = false;
    };
  }, [visible, api, attempt]);

  const allSeries = useMemo(() => {
    const have = new Set((list ?? []).map((d) => d.series).filter(Boolean));
    return [...SERIES_ORDER.filter((x) => have.has(x)), ...[...have].filter((x) => !SERIES_ORDER.includes(x)).sort()];
  }, [list]);
  const currentSeries = list?.find((d) => d.id === current?.deviceId)?.series ?? null;
  const start = oldSeries && allSeries.includes(oldSeries) ? oldSeries : currentSeries && allSeries.includes(currentSeries) ? currentSeries : (allSeries[0] ?? "");
  const shown = series ?? start;
  const suggestedId = current?.suggested ? current.deviceId : null;
  const rows = useMemo(() => {
    const inSeries = (list ?? []).filter((d) => d.series === shown);
    // The suggestion first; otherwise the catalogue's own order (the server's sort, then price).
    return [...inSeries.filter((d) => d.id === suggestedId), ...inSeries.filter((d) => d.id !== suggestedId)];
  }, [list, shown, suggestedId]);

  async function choose(d: NewDevice) {
    if (busyId) return;
    // Tapping the phone already on the case changes nothing — and must not turn SwapUp's suggestion into a staff pick.
    if (d.id === current?.deviceId) return onClose();
    setErr(null);
    setBusyId(d.id);
    const e = await save({ upgradeDeviceId: d.id });
    setBusyId(null);
    if (e) setErr(e);
    else onClose();
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Choose the new phone"
      lead={current?.suggested && current.why ? `Suggested: ${current.why}` : "The bonus and what the customer pays follow the phone you choose."}
    >
      <Problem text={err} />
      {loadErr ? (
        <View style={{ marginTop: 14, gap: 10 }}>
          <Notice tone="fail">{loadErr}</Notice>
          <QuietLink title="Try again" onPress={() => setAttempt((n) => n + 1)} />
        </View>
      ) : list === null ? (
        <Text style={{ color: L.muted, fontSize: 16, marginTop: 14 }}>Loading the new phones…</Text>
      ) : list.length === 0 ? (
        <Notice style={{ marginTop: 14 }}>There are no new phones in this programme's catalogue. Ask the programme to add them.</Notice>
      ) : (
        <View style={{ gap: 10, marginTop: 16 }}>
          {allSeries.length > 1 ? <Segmented options={allSeries.map((x) => ({ value: x, label: x }))} value={shown} onChange={setSeries} /> : null}
          {rows.map((d) => (
            <Option
              key={d.id}
              title={`${d.model} ${d.variant} — ${inr(d.price)}${d.id === suggestedId ? " · Suggested" : ""}${busyId === d.id ? " · saving…" : ""}`}
              selected={d.id === current?.deviceId}
              onPress={() => void choose(d)}
            />
          ))}
        </View>
      )}
    </Sheet>
  );
}

// ── refurb quote (what the CUSTOMER pays to fix it) ─────────────────────────

/** Where a typed repair quote comes from. Each is longer than the server's 8-character minimum reason. */
export const REFURB_SOURCES = ["Bench quote at this centre", "Service centre job sheet", "Customer's quote from another shop"] as const;

/** A manual quote's detail is `Quote: <reason>` (spec §3.2): read back the source chip and the job-sheet number. */
function manualFrom(repair: Offer["repair"]): { amount: string; source: string; jobNo: string } {
  if (repair.basis !== "manual" || repair.amount === null) return { amount: "", source: "", jobNo: "" };
  const reason = repair.detail?.startsWith("Quote: ") ? repair.detail.slice("Quote: ".length) : "";
  const source = REFURB_SOURCES.find((x) => reason.startsWith(x)) ?? "";
  const jobNo = source ? reason.slice(source.length).replace(/^\s*·\s*/, "") : "";
  return { amount: String(repair.amount), source, jobNo };
}

export function RefurbQuoteSheet({ visible, onClose, repair, save }: { visible: boolean; onClose: () => void; repair: Offer["repair"]; save: SaveFn }) {
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("");
  const [jobNo, setJobNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const m = manualFrom(repair);
    setAmount(m.amount);
    setSource(m.source);
    setJobNo(m.jobNo);
    setErr(null);
    // Only on opening: a refresh behind the sheet must not wipe what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const n = rupees(amount);
  const problem = n === null ? "Enter the repair quote in whole rupees." : n > MAX_RUPEES ? "Whole rupees, up to ₹5,00,000." : !source ? "Choose where the quote comes from." : null;

  async function submit(patch: Record<string, unknown>) {
    setErr(null);
    setBusy(true);
    const e = await save(patch);
    setBusy(false);
    if (e) setErr(e);
    else onClose();
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Enter the repair quote"
      lead="What fixing this phone costs the customer. It replaces SwapUp's estimate."
      footer={
        <>
          <PillButton
            title={busy ? "Saving…" : "Save the repair quote"}
            busy={busy}
            disabled={!!problem}
            onPress={() => {
              if (problem || n === null) return;
              const reason = jobNo.trim() ? `${source} · ${jobNo.trim()}` : source;
              void submit({ manualRepair: { amount: n, reason } });
            }}
          />
          {repair.basis === "manual" ? <QuietLink title="Use SwapUp's estimate" disabled={busy} onPress={() => void submit({ manualRepair: null })} /> : null}
        </>
      }
    >
      <View style={{ gap: 16, marginTop: 18 }}>
        <Field
          label="Repair quote (₹)"
          value={amount}
          onChangeText={(t) => setAmount(rupeesInput(t))}
          keyboardType="number-pad"
          inputMode="numeric"
          placeholder="e.g. 9000"
          hint="Whole rupees, up to ₹5,00,000."
          error={n !== null && n > MAX_RUPEES ? "Whole rupees, up to ₹5,00,000." : null}
          accessibilityLabel="Repair quote in rupees"
        />
        <View style={{ gap: 8 }}>
          <Label>Where it comes from</Label>
          <Segmented options={REFURB_SOURCES.map((x) => ({ value: x, label: x }))} value={source} onChange={setSource} />
        </View>
        <Field label="Job-sheet number (optional)" value={jobNo} onChangeText={(t) => setJobNo(t.slice(0, 40))} autoCapitalize="characters" autoCorrect={false} placeholder="e.g. JS-20481" />
      </View>
      {amount && problem ? <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20, marginTop: 12 }}>{problem}</Text> : null}
      <Problem text={err} />
    </Sheet>
  );
}

// ── cover ────────────────────────────────────────────────────────────────────

export const COVER_LABEL: Record<Coverage, string> = { none: "None", warranty: "Warranty", care_plus: "Care+" };

export function CoverSheet({ visible, onClose, coverage, save }: { visible: boolean; onClose: () => void; coverage: Coverage; save: SaveFn }) {
  const [busy, setBusy] = useState<Coverage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (visible) setErr(null);
  }, [visible]);

  async function choose(c: Coverage) {
    if (busy) return;
    if (c === coverage) return onClose();
    setErr(null);
    setBusy(c);
    const e = await save({ coverage: c });
    setBusy(null);
    if (e) setErr(e);
    else onClose();
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Is the repair covered?" lead="The refurb quote follows the cover.">
      <Problem text={err} />
      <View style={{ gap: 10, marginTop: 16 }}>
        {(Object.keys(COVER_LABEL) as Coverage[]).map((c) => (
          <Option key={c} title={`${COVER_LABEL[c]}${busy === c ? " · saving…" : ""}`} selected={c === coverage} onPress={() => void choose(c)} />
        ))}
      </View>
    </Sheet>
  );
}

// ── the partner's quote, read off the Cashify app ───────────────────────────

export function PartnerQuoteSheet({ visible, onClose, save }: { visible: boolean; onClose: () => void; save: SaveFn }) {
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [repaired, setRepaired] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setAmount("");
    setReference("");
    setRepaired("");
    setErr(null);
  }, [visible]);

  const n = rupees(amount);
  const rep = rupees(repaired);
  const refOk = /^[A-Z0-9-]{4,40}$/.test(reference);
  // The server's own sentences (updateCase, partnerQuote).
  const problem =
    n === null || n <= 0 || n > MAX_RUPEES
      ? "Enter the partner's quote as a whole rupee amount."
      : !refOk
        ? "Enter the reference code the partner's app shows for this quote."
        : rep !== null && rep < n
          ? "The repaired value must be a whole rupee amount, at least the as-is quote."
          : null;

  async function submit() {
    if (problem || n === null) return;
    setErr(null);
    setBusy(true);
    const e = await save({ partnerQuote: { amount: n, reference, repairedAmount: rep } });
    setBusy(false);
    if (e) setErr(e);
    else onClose();
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Enter the Cashify quote"
      lead="Price this phone in the Cashify app, then type its as-is price and the quote's reference code."
      footer={<PillButton title={busy ? "Saving…" : "Save the quote"} busy={busy} disabled={!!problem} onPress={() => void submit()} />}
    >
      <View style={{ gap: 16, marginTop: 18 }}>
        <Field label="As-is price (₹)" value={amount} onChangeText={(t) => setAmount(rupeesInput(t))} keyboardType="number-pad" inputMode="numeric" placeholder="e.g. 18800" />
        <Field
          label="Reference code"
          value={reference}
          onChangeText={(t) => setReference(t.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40))}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="e.g. CFY-82731"
          hint="Letters, digits and dashes, as the app shows it."
        />
        <Field
          label="Repaired value (optional)"
          value={repaired}
          onChangeText={(t) => setRepaired(rupeesInput(t))}
          keyboardType="number-pad"
          inputMode="numeric"
          placeholder="What Cashify pays once it is repaired"
        />
      </View>
      {(amount || reference) && problem ? <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20, marginTop: 12 }}>{problem}</Text> : null}
      <Problem text={err} />
    </Sheet>
  );
}

// ── closing the case ─────────────────────────────────────────────────────────

export function RepairConfirmSheet({ visible, onClose, act }: { visible: boolean; onClose: () => void; act: ActFn }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (visible) setErr(null);
  }, [visible]);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Customer will repair"
      lead="This closes the case. Book the repair in the service centre's job system."
      footer={
        <>
          <PillButton
            title={busy ? "Closing the case…" : "Customer will repair"}
            busy={busy}
            onPress={async () => {
              setErr(null);
              setBusy(true);
              const e = await act("choose_repair");
              setBusy(false);
              if (e) setErr(e);
              else onClose();
            }}
          />
          <QuietLink title="Not yet" onPress={onClose} disabled={busy} />
        </>
      }
    >
      <Problem text={err} />
    </Sheet>
  );
}

export const WALK_AWAY_REASONS = ["Too expensive", "Will think about it", "Repairing elsewhere", "Other"] as const;

export function WalkAwaySheet({ visible, onClose, act }: { visible: boolean; onClose: () => void; act: ActFn }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setReason("");
    setErr(null);
  }, [visible]);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Customer walked away"
      lead="This closes the case. Why, if the customer said:"
      footer={
        <>
          <PillButton
            title={busy ? "Closing the case…" : "Customer walked away"}
            busy={busy}
            onPress={async () => {
              setErr(null);
              setBusy(true);
              const e = await act("walk_away", reason ? { reason } : {});
              setBusy(false);
              if (e) setErr(e);
              else onClose();
            }}
          />
          <QuietLink title="Not yet" onPress={onClose} disabled={busy} />
        </>
      }
    >
      <View style={{ marginTop: 16 }}>
        {/* Optional: tap the chosen one again to clear it. */}
        <Segmented options={WALK_AWAY_REASONS.map((x) => ({ value: x, label: x }))} value={reason} onChange={(v) => setReason((r) => (r === v ? "" : v))} />
      </View>
      <Problem text={err} />
    </Sheet>
  );
}

// ── why this answer ─────────────────────────────────────────────────────────

/** The round "?" next to the headline: the server's signals and caveats, nothing the app made up. Hidden when there are none. */
export function WhySheet({ offer }: { offer: Offer }) {
  if (!offer.signals.length && !offer.caveats.length) return null;
  return (
    <HelpButton title="Why this answer" label="Why this answer">
      <View style={{ gap: 12, marginTop: 16 }}>
        {offer.signals.map((x, i) => (
          <View key={`s${i}`} style={{ gap: 2 }}>
            <Text style={{ color: x.points === "repair" ? L.fix : L.ink, fontSize: 13, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>
              {`Points to ${x.points === "repair" ? "repair" : "upgrade"} · ${x.strength}`}
            </Text>
            <Text style={{ color: L.ink, fontSize: 16, lineHeight: 23 }}>{x.text}</Text>
          </View>
        ))}
        {offer.caveats.length ? (
          <View style={{ gap: 6, marginTop: offer.signals.length ? 6 : 0 }}>
            <Label>Good to know</Label>
            {offer.caveats.map((c, i) => (
              <Text key={`c${i}`} style={{ color: L.muted, fontSize: 15, lineHeight: 22 }}>
                {`• ${c}`}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </HelpButton>
  );
}
