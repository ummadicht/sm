// THE ANSWER, once the test is on the case (owner, 2026-10-17: "Why asking questions when
// we have all tested data ... just refurb quote vs bonus + trade in price"):
//
//   one headline (the verdict) · one sentence · two numbers side by side —
//   REFURB QUOTE (what the customer pays to fix it) | TRADE-IN + BONUS — · one docked pill.
//
// Whatever the test couldn't fill is a one-tap ask above the numbers (storage chips with
// each size's trade-in — and the server's one note under them, as sent — a quote, the new
// phone) — never a form, never a guessed size, never a made-up price. A
// choice the server refuses (no new phone yet, an expired partner quote) can't be tapped, and
// says why. The store's own refurb cost and margin sit at the bottom, closed: "Store margin ·
// staff only" (./PriceCard, drawn from this screen's case and saved through its queue).
//
// The SwapUp grade (CaseView.grading, grading spec §5) is one line between the headline and
// the asks — "SwapUp grade: Good (B)", the server's label as sent, " · provisional" in amber —
// with the server's one-line why, "View report" (the public report page, in the app's browser)
// and "Show to customer" (a QR of it, ./ReportQrSheet). Never inside the two tiles: those stay
// the partner's money only, and the grade never moves a price. "Get Phonecheck results" shows
// only when the server says the store can pull them (Phonecheck ships switched off).
//
// It is reached BY ITSELF (owner, 2026-10-17: "Reduce the flow"): the server puts the phone's
// results on the case once its tests and the camera grade are in, and the Session screen opens
// this. What the camera couldn't decide was certified inside the camera step before that, so
// "Check the phone" (./CertifyCard) shows here only while a row is still open — the results went
// on first (a manual Apply) — never as a second copy of the card.
//
// The server builds every number and every reason (CaseView.offer, read by ../offer.ts);
// this screen owns the labels only. Load: GET /api/cases/<id> (an expired quote, or storage
// chips with no price at all, is re-priced once, quietly), again quietly every 30 s and when
// the app returns to the front. Writes go one at a time and only the newest answer is painted (the
// desk's CaseWorkspace.run); a refusal re-reads the case and says why in the server's words.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, View } from "react-native";
import { QuietLink } from "../../shared/kit";
import {
  type CaseGrading,
  type CaseHead,
  type Offer,
  type OfferAsk,
  type Pick as Choice,
  type TradeInDetail,
  CHOOSE_PHONE,
  bonusLine,
  chipLabel,
  defaultPick,
  detailAmount,
  gradeLine,
  newPhoneLine,
  pickAllowed,
  pill,
  readCaseGrade,
  readCaseHead,
  readOffer,
  readPull,
  recommendedBadge,
  storageHandoff,
  swapRefusalLine,
  swapWhyLine,
  vsRepairLine,
  wantsReprice,
} from "../offer";
import { type CasePrice, readCasePrice } from "../buySell";
import { type CertifyView, answerCertify, readCertify } from "../certify";
import { answerCertifyMode, checkedByLine } from "../flow";
import { CheckThePhone } from "./CertifyCard";
import { type StaffClient, absolute, errText } from "../staffClient";
import type { Screen } from "../types";
import { Banner, Body, Btn, Card, Chip, Figure, H1, H2, KV, L, Label, Segmented, inr, s as ui, useHead, useLayout } from "../ui";
import { PriceCard } from "./PriceCard";
import { COVER_LABEL, CoverSheet, NewPhoneSheet, PartnerQuoteSheet, RefurbQuoteSheet, RepairConfirmSheet, WalkAwaySheet, WhySheet } from "./OfferSheets";
import { ReportQrSheet } from "./ReportQrSheet";

const REFRESH_MS = 30_000;
/** The answer is read at arm's length: wider than this and the lines get too long to scan. */
const MAX_W = 760;

/** The few CaseView fields the answer reads besides the offer and the head. */
type Extra = {
  /** The customer's phone's series ("S", "A"…): the new-phone list opens there. */
  series: string | null;
  quoteExpired: boolean;
  /** What was locked (lockTradeIn): the traded-in summary prefers these to today's offer. */
  tradeValue: number | null;
  bonusValue: number | null;
  payable: number | null;
  upgradeLabel: string | null;
};

function readExtra(x: unknown): Extra {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const sub = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
  const dev = sub(o.device);
  const up = sub(o.upgrade);
  return {
    series: typeof dev?.series === "string" && dev.series ? dev.series : null,
    quoteExpired: o.quoteExpired === true,
    tradeValue: num(o.tradeValue),
    bonusValue: num(o.bonusValue),
    payable: num(o.payable),
    upgradeLabel: typeof up?.label === "string" && up.label ? up.label : null,
  };
}

/** `price`: the same case as the store-margin card reads it (../buySell.ts). */
/** `cert`: the case's own `certify` / `certification`, as sent (../certify.ts answerCertify reads them). */
type Ready = { state: "ready"; head: CaseHead; offer: Offer | null; grading: CaseGrading | null; price: CasePrice | null; extra: Extra; cert: { certify?: unknown; certification?: unknown } };
type Load = { state: "loading" } | { state: "error"; text: string } | Ready;
type SheetName = "phone" | "refurb" | "cover" | "partner" | "repair" | "walk" | "report" | null;

const OPEN = new Set(["draft", "quoted"]);

export function OfferScreen({
  api,
  caseId,
  caseRef,
  back,
  onBack,
  onOpenWeb,
  onLock,
  onHome,
}: {
  api: StaffClient;
  caseId: string;
  /** Shown while the case loads (the screen's own ref). */
  caseRef: string;
  /** Where "‹" goes — it only picks the label; onBack does the going. */
  back: Screen;
  onBack: () => void;
  onOpenWeb: (url: string, title: string) => void;
  /** "Swap up": the lock form for this case. */
  onLock: (caseId: string) => void;
  onHome: () => void;
}) {
  const { wide, pad, content } = useLayout();
  const path = `/api/cases/${encodeURIComponent(caseId)}`;
  // Came from the test session: its "Check the phone" rows (which are needed) stand in when the case doesn't send its own.
  const sessionId = back.name === "session" ? back.id : null;
  const [sessionCertify, setSessionCertify] = useState<CertifyView | null>(null);
  const answerPath = `/cases/${caseId}?view=answer`;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [pending, setPending] = useState(0);
  const [err, setErr] = useState<{ title: string; text: string } | null>(null);
  const [chosen, setChosen] = useState<Choice | null>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [certifyOpen, setCertifyOpen] = useState(false);
  const [margin, setMargin] = useState(false);
  const [handoff, setHandoff] = useState(false);
  /** The storage chip just tapped, outlined until the server's answer lands. */
  const [tapped, setTapped] = useState<string | null>(null);
  /** "Get Phonecheck results": on its way, and what came of it (the app's words for the server's outcome). */
  const [pulling, setPulling] = useState(false);
  const [pullNote, setPullNote] = useState<string | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** A case from the server (GET, PATCH or /action all answer with the whole CaseView): show it. */
  const take = useCallback((r: unknown) => {
    const head = readCaseHead(r);
    if (!head) throw new Error("Bad answer from the server.");
    const v = r as { offer?: unknown; grading?: unknown };
    const o = r as { certify?: unknown; certification?: unknown };
    setLoad({ state: "ready", head, offer: readOffer(v.offer), grading: readCaseGrade(v.grading), price: readCasePrice(r), extra: readExtra(r), cert: { certify: o.certify, certification: o.certification } });
  }, []);

  // ── writes: one at a time; only the newest answer is painted (the desk's CaseWorkspace.run)
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const ticket = useRef(0);
  const pendingRef = useRef(0);
  const run = useCallback(
    /** null = done; else the server's reason. `bannerTitle` null = the caller (a sheet) shows the reason itself. */
    (fn: () => Promise<unknown>, bannerTitle: string | null = "Not saved"): Promise<string | null> => {
      const mine = ++ticket.current;
      pendingRef.current += 1;
      setPending(pendingRef.current);
      const p = queue.current.then(async () => {
        try {
          const r = await fn();
          if (alive.current && mine === ticket.current) take(r);
          if (alive.current && bannerTitle) setErr(null);
          return null;
        } catch (e) {
          const text = errText(e);
          // Re-sync with what the server actually holds, so the screen never shows an unsaved state.
          try {
            const r = await api.get<unknown>(path);
            if (alive.current && mine === ticket.current) take(r);
          } catch {
            /* keep what we have; the reason below says what failed */
          }
          if (alive.current && bannerTitle) setErr({ title: bannerTitle, text });
          return text;
        } finally {
          pendingRef.current -= 1;
          if (alive.current) setPending(pendingRef.current);
        }
      });
      queue.current = p.catch(() => null);
      return p;
    },
    [api, path, take]
  );
  const save = useCallback((patch: Record<string, unknown>) => run(() => api.patch<unknown>(path, patch), null), [api, path, run]);
  const act = useCallback(
    (action: string, extra: Record<string, unknown> = {}) => run(() => api.post<unknown>(`${path}/action`, { action, ...extra }), null),
    [api, path, run]
  );

  // ── reads
  const fetchCase = useCallback(
    async (quiet: boolean) => {
      // A write is on its way: its answer is newer than anything a refresh would bring.
      if (quiet && pendingRef.current > 0) return;
      const before = ticket.current;
      if (!quiet) setLoad({ state: "loading" });
      try {
        const r = await api.get<unknown>(path);
        if (!alive.current) return;
        if (quiet && (ticket.current !== before || pendingRef.current > 0)) return;
        take(r);
      } catch (e) {
        // A quiet refresh that fails keeps the screen as it was; the next one tries again.
        if (alive.current && !quiet) setLoad({ state: "error", text: errText(e) });
      }
    },
    [api, path, take]
  );

  useEffect(() => {
    if (!sessionId) return;
    let on = true;
    api
      .get<unknown>(`/api/test-sessions/${encodeURIComponent(sessionId)}`)
      .then((r) => {
        const sv = r && typeof r === "object" && "session" in (r as object) ? (r as { session: unknown }).session : r;
        if (on) setSessionCertify(readCertify(sv));
      })
      .catch(() => {
        /* no card from the session — the case's own, if it sends one */
      });
    return () => {
      on = false;
    };
  }, [api, sessionId]);

  useEffect(() => {
    void fetchCase(false);
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") void fetchCase(true);
    });
    const t = setInterval(() => {
      if (AppState.currentState === "active") void fetchCase(true);
    }, REFRESH_MS);
    return () => {
      sub.remove();
      clearInterval(t);
    };
  }, [fetchCase]);

  // An expired partner quote, or storage chips none of which has a price (the case was priced
  // before the server kept a price per size), is fetched again by a re-price — once, quietly.
  const repriced = useRef(false);
  const reprice = load.state === "ready" && wantsReprice(OPEN.has(load.head.status), load.extra.quoteExpired, load.offer);
  useEffect(() => {
    if (!reprice || repriced.current) return;
    repriced.current = true;
    void run(() => api.post<unknown>(`${path}/action`, { action: "reprice" }), null);
  }, [reprice, api, path, run]);

  /**
   * POST /api/cases/<id>/phonecheck {mode: "pull"} through the write queue. Its answer is
   * {case, record, outcome}: the case is painted like any other write's, the outcome said under
   * the grade. A refusal (not set up, an IMEI that doesn't match, too soon) is the server's words.
   */
  async function pullPhonecheck() {
    if (pulling) return;
    setPulling(true);
    setPullNote(null);
    const got = { text: null as string | null };
    const e = await run(async () => {
      const r = await api.post<unknown>(`${path}/phonecheck`, { mode: "pull" });
      const p = readPull(r);
      if (!p) throw new Error("Bad answer from Phonecheck.");
      got.text = p.text;
      return p.caseView ?? (await api.get<unknown>(path));
    }, "No Phonecheck results");
    if (!alive.current) return;
    setPulling(false);
    if (!e) setPullNote(got.text);
  }

  /** The desk for what the app leaves to it (POST /api/auth/handoff, then the in-app browser). */
  async function openFull(next: string) {
    setErr(null);
    setHandoff(true);
    try {
      const r = await api.post<{ url?: string }>("/api/auth/handoff", { next });
      if (!r?.url) throw new Error("No link came back. Try again.");
      onOpenWeb(absolute(api.base, r.url), `Case ${load.state === "ready" ? load.head.ref || caseRef : caseRef}`);
    } catch (e) {
      if (alive.current) setErr({ title: "Couldn't open the case", text: errText(e) });
    } finally {
      if (alive.current) setHandoff(false);
    }
  }

  const backLabel = back.name === "session" ? "‹ Test results" : back.name === "home" ? "‹ Home" : "‹ Back";
  const maxW = Math.min(content, MAX_W);
  const column = { alignSelf: "center" as const, width: maxW + pad * 2 };

  if (load.state !== "ready") {
    return (
      <View style={{ flex: 1 }}>
        <OfferTop title={caseRef} left={{ label: backLabel, onPress: onBack }} />
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

  const { head, offer: o, grading, price, extra } = load;
  const certify = answerCertify(load.cert, sessionCertify, sessionId);
  const ref = head.ref || caseRef;
  // The public report page: no sign-in and no hand-off — it carries no prices.
  const reportUrl = grading?.report ? absolute(api.base, grading.report.path) : null;
  const viewReport = () => {
    if (reportUrl) onOpenWeb(reportUrl, `Grade report · ${ref}`);
  };
  const reportSheet =
    grading && reportUrl ? <ReportQrSheet visible={sheet === "report"} onClose={() => setSheet(null)} url={reportUrl} grading={grading} onOpen={viewReport} /> : null;
  const claimed = (o?.storage.source ?? head.variantSource) === "customer";
  const top = (
    <OfferTop
      title={ref}
      sub={`${head.deviceLabel ?? "Model ?"} · ${head.variant ?? "storage ?"}`}
      claimed={claimed}
      left={{ label: backLabel, onPress: onBack }}
      busy={pending > 0 || handoff}
    />
  );
  const banner = err ? (
    <Banner tone="bad" title={err.title}>
      {err.text}
    </Banner>
  ) : null;

  // ── finished: the case is closed one way or another
  if (!OPEN.has(head.status)) {
    const traded = head.status !== "repair_chosen" && head.status !== "walked_away";
    const cancelled = head.status === "cancelled";
    const headline = head.status === "repair_chosen" ? "Customer will repair" : head.status === "walked_away" ? "Customer walked away" : cancelled ? "Trade-in cancelled" : "Traded in";
    const rows = traded && !cancelled;
    return (
      <View style={{ flex: 1 }}>
        {top}
        <ScrollView contentContainerStyle={[column, { padding: pad, gap: 16 }]}>
          <H1>{headline}</H1>
          {head.status === "repair_chosen" ? <Body muted>Book it in the job system.</Body> : null}
          {banner}
          {rows ? (
            <Card style={{ gap: 0 }}>
              <KV label="Trade-in" value={inr(extra.tradeValue ?? o?.swap.tradeIn ?? null)} />
              <KV label="Bonus" value={inr(extra.bonusValue ?? o?.swap.bonus ?? null)} />
              <KV label="New phone" value={extra.upgradeLabel ?? o?.swap.newPhone?.label ?? "—"} />
              <KV label="Customer pays" value={inr(extra.payable ?? o?.swap.customerPays ?? null)} />
              {grading ? <KV label="SwapUp grade" value={gradeLine(grading).full} /> : null}
              {reportUrl ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 20, paddingTop: 8 }}>
                  <TextLink title="Grade report" onPress={viewReport} />
                  <TextLink title="Show to customer" onPress={() => setSheet("report")} />
                </View>
              ) : null}
            </Card>
          ) : null}
        </ScrollView>
        <View style={[column, { paddingHorizontal: pad, paddingTop: 8, paddingBottom: 14, gap: 4 }]}>
          {rows ? (
            <>
              <Btn title="Clear the data" big busy={handoff} onPress={() => void openFull(`/cases/${caseId}`)} />
              <QuietLink title="Back to Home" onPress={onHome} />
            </>
          ) : (
            <>
              <Btn title="Back to Home" big onPress={onHome} />
              {cancelled ? <QuietLink title="Open full case" disabled={handoff} onPress={() => void openFull(`/cases/${caseId}`)} /> : null}
            </>
          )}
        </View>
        {rows ? reportSheet : null}
      </View>
    );
  }

  // ── an older server sends no answer: say so, and send the advisor to the desk
  if (!o) {
    return (
      <View style={{ flex: 1 }}>
        {top}
        <ScrollView contentContainerStyle={[column, { padding: pad, gap: 16 }]}>
          <H1>Price it on the full case</H1>
          <Body muted>This server can't send the answer yet.</Body>
          {banner}
        </ScrollView>
        <View style={[column, { paddingHorizontal: pad, paddingTop: 8, paddingBottom: 14 }]}>
          <Btn title="Open full case" big busy={handoff} onPress={() => void openFull(answerPath)} />
        </View>
      </View>
    );
  }

  // ── the answer
  const pick = chosen && pickAllowed(o, chosen) ? chosen : defaultPick(o);
  const p = pill(o, pick);
  const badge = recommendedBadge(o);
  const figSize = (t: string) => (wide ? 40 : t.length > 8 ? 22 : 28);

  // Refurb quote
  const r = o.repair;
  const repairTxt = r.amount !== null ? inr(r.amount) : "—";
  const repairWhy = r.amount === null && !r.nothingToRepair ? r.why : null;
  const repairRefusal = o.actions.repair && o.actions.repair !== repairWhy && !(r.nothingToRepair && o.actions.repair === r.why) ? o.actions.repair : null;
  // Trade-in + bonus
  const w = o.swap;
  const totalTxt = w.total !== null ? inr(w.total) : "—";
  const bonus = bonusLine(o);
  const phoneLine = newPhoneLine(o);
  const vs = vsRepairLine(w.vsRepair);
  const swapWhy = swapWhyLine(o);
  // The server's reason the swap can't be taken, unless the tile already says it (the why, the note, the link).
  const swapRefusal = swapRefusalLine(o);

  return (
    <View style={{ flex: 1 }}>
      {top}
      <ScrollView contentContainerStyle={[column, { padding: pad, gap: 16 }]} keyboardShouldPersistTaps="handled">
        {/* One headline, one sentence; the reasons behind them in the "?" sheet */}
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            <H1 style={{ flex: 1, minWidth: 0, fontSize: wide ? 34 : 28, lineHeight: wide ? 40 : 34 }}>{o.headline}</H1>
            <WhySheet offer={o} />
          </View>
          {o.reason ? <Body muted>{o.reason}</Body> : null}
          {/* A safety warning is never behind the "?" */}
          {o.safety ? (
            <Small color={L.warn} weight="600">
              {o.safety}
            </Small>
          ) : null}
        </View>
        {banner}

        {/* The SwapUp grade: beside the answer, never inside its tiles */}
        {grading ? (
          <GradeCard
            g={grading}
            canReport={!!reportUrl}
            pulling={pulling}
            note={pullNote}
            onView={viewReport}
            onShow={() => setSheet("report")}
            onPull={() => void pullPhonecheck()}
          />
        ) : null}

        {/* What the camera couldn't decide, still open — the advisor's taps, by name (the server says which rows) */}
        {/* Tapped in full: closed, one tap to change a wrong last tap (the answer opened by itself after it) */}
        {certify && answerCertifyMode(certify) === "change" && !certifyOpen ? (
          <Pressable onPress={() => setCertifyOpen(true)} accessibilityRole="button" style={{ paddingVertical: 4 }}>
            <Text style={{ color: L.fix, fontSize: 15, fontWeight: "700" }}>{checkedByLine(certify)}</Text>
          </Pressable>
        ) : null}
        {certify && (answerCertifyMode(certify) === "open" || (answerCertifyMode(certify) === "change" && certifyOpen)) ? (
          <CheckThePhone
            view={certify}
            onTap={(row, value) => act("certify", { row, value, ...(certify.testSessionId ? { testSessionId: certify.testSessionId } : {}) })}
          />
        ) : null}

        {/* What the answer still needs — one tap each */}
        {o.asks.map((a) => (
          <AskCard
            key={a.kind}
            ask={a}
            headline={o.headline}
            reason={o.reason}
            variant={tapped ?? head.variant}
            measuredStorage={head.measuredStorage}
            handoff={handoff}
            onVariant={(v) => {
              setTapped(v);
              void run(() => api.patch<unknown>(path, { variant: v })).then(() => {
                if (alive.current) setTapped(null);
              });
            }}
            onSheet={setSheet}
            onFull={(hash) => void openFull(`${answerPath}${hash}`)}
          />
        ))}

        {/* The two numbers, side by side even on a phone */}
        <View style={{ flexDirection: "row", gap: wide ? 16 : 10, alignItems: "stretch" }}>
          <Tile label="Refurb quote" selected={pick === "repair"} disabled={!pickAllowed(o, "repair")} recommended={badge === "repair"} wide={wide} onPress={() => setChosen("repair")}>
            {r.nothingToRepair && r.amount === null ? (
              <NothingToRepair wide={wide} />
            ) : (
              <Figure size={figSize(repairTxt)} color={r.amount === null ? L.muted : L.ink}>
                {repairTxt}
              </Figure>
            )}
            {r.amount !== null && r.detail ? <Small>{r.detail}</Small> : null}
            {repairWhy ? <Small>{repairWhy}</Small> : null}
            {repairRefusal ? <Small color={L.ink}>{repairRefusal}</Small> : null}
            {r.amount !== null && !r.nothingToRepair ? <TextLink title="Change" onPress={() => setSheet("refurb")} /> : null}
            {!r.nothingToRepair ? <TextLink title={`Cover: ${COVER_LABEL[r.coverage]} · change`} onPress={() => setSheet("cover")} /> : null}
          </Tile>

          <Tile label="Trade-in + bonus" selected={pick === "swap"} disabled={!pickAllowed(o, "swap")} recommended={badge === "swap"} wide={wide} onPress={() => setChosen("swap")}>
            <Figure size={figSize(totalTxt)} color={w.total === null ? L.muted : L.ink}>
              {totalTxt}
            </Figure>
            {swapWhy ? <Small>{swapWhy}</Small> : null}
            {bonus ? <Small>{bonus}</Small> : null}
            {w.tradeInDetail ? <TradeInHow d={w.tradeInDetail} /> : null}
            {w.tradeInNote ? (
              <Small color={L.warn} weight="600">
                {w.tradeInNote}
              </Small>
            ) : null}
            {phoneLine ? (
              <View style={{ gap: 4, marginTop: 2 }}>
                {w.newPhone?.suggested ? <Chip text="Suggested" tone="fix" /> : null}
                <Small color={L.ink}>{phoneLine}</Small>
                <TextLink title="Change" onPress={() => setSheet("phone")} />
              </View>
            ) : (
              <TextLink title={CHOOSE_PHONE} onPress={() => setSheet("phone")} />
            )}
            {vs ? <Small>{vs}</Small> : null}
            {swapRefusal ? <Small color={L.ink}>{swapRefusal}</Small> : null}
          </Tile>
        </View>

        {/* The quiet row */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
          {o.actions.walkAway === null ? <QuietLink title="Customer walked away" onPress={() => setSheet("walk")} /> : null}
          <QuietLink title={handoff ? "Opening…" : "Open full case"} disabled={handoff} onPress={() => void openFull(answerPath)} />
        </View>

        {/* The store's buy vs sell — staff only, closed by default */}
        <View style={{ gap: 12 }}>
          <Pressable
            onPress={() => setMargin((m) => !m)}
            accessibilityRole="button"
            accessibilityState={{ expanded: margin }}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingHorizontal: 4, opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={{ flex: 1, color: L.muted, fontSize: 16, fontWeight: "600" }}>Store margin · staff only</Text>
            <Text style={{ color: L.muted, fontSize: 22, transform: [{ rotate: margin ? "90deg" : "0deg" }] }}>›</Text>
          </Pressable>
          {/* The case this screen holds: every answer from the server repaints it, so BUY is never stale. */}
          {margin && price ? <PriceCard c={price} save={save} /> : null}
        </View>
      </ScrollView>

      {/* One docked pill: what the customer chose */}
      <View style={[column, { paddingHorizontal: pad, paddingTop: 8, paddingBottom: 14, gap: 8 }]}>
        {p.disabled && p.caption ? <Text style={{ color: L.muted, fontSize: 15, lineHeight: 21, textAlign: "center" }}>{p.caption}</Text> : null}
        <Btn
          title={p.title}
          big
          disabled={p.disabled}
          onPress={() => {
            if (pick === "repair") setSheet("repair");
            else if (pick === "swap") onLock(caseId);
          }}
        />
      </View>

      <NewPhoneSheet api={api} visible={sheet === "phone"} onClose={() => setSheet(null)} current={w.newPhone} oldSeries={extra.series} save={save} />
      <RefurbQuoteSheet visible={sheet === "refurb"} onClose={() => setSheet(null)} repair={r} save={save} />
      <CoverSheet visible={sheet === "cover"} onClose={() => setSheet(null)} coverage={r.coverage} save={save} />
      <PartnerQuoteSheet visible={sheet === "partner"} onClose={() => setSheet(null)} save={save} />
      <RepairConfirmSheet visible={sheet === "repair"} onClose={() => setSheet(null)} act={act} />
      <WalkAwaySheet visible={sheet === "walk"} onClose={() => setSheet(null)} act={act} />
      {reportSheet}
    </View>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────

/** The store TopBar, with the storage's source in the subtitle: "· customer said" in amber when the phone couldn't measure it. */
function OfferTop({ title, sub, claimed, left, busy }: { title: string; sub?: string; claimed?: boolean; left: { label: string; onPress: () => void }; busy?: boolean }) {
  const face = useHead("700");
  return (
    <View style={ui.top}>
      <Pressable onPress={left.onPress} hitSlop={12} accessibilityRole="button" style={({ pressed }) => [ui.topLeft, pressed && { opacity: 0.6 }]}>
        <Text style={ui.topLeftText}>{left.label}</Text>
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[ui.topTitle, face]} numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text style={ui.topSub} numberOfLines={2}>
            {sub}
            {claimed ? <Text style={{ color: L.warn, fontWeight: "600" }}> · customer said</Text> : null}
          </Text>
        ) : null}
      </View>
      {busy ? <ActivityIndicator color={L.primary} accessibilityLabel="Updating" /> : null}
    </View>
  );
}

/**
 * "SwapUp grade: Good (B)" and the server's one-line why, with the report's two links — and the
 * Phonecheck pull only where the server allows it. Provisional is the amber " · provisional".
 */
function GradeCard({
  g,
  canReport,
  pulling,
  note,
  onView,
  onShow,
  onPull,
}: {
  g: CaseGrading;
  canReport: boolean;
  pulling: boolean;
  /** What the last Phonecheck pull came to. */
  note: string | null;
  onView: () => void;
  onShow: () => void;
  onPull: () => void;
}) {
  const line = gradeLine(g);
  const canPull = g.phonecheck?.canPull === true;
  return (
    <Card style={{ gap: 6, padding: 16 }}>
      <Text style={{ color: L.ink, fontSize: 18, lineHeight: 24, fontWeight: "700" }} accessibilityLabel={`SwapUp grade ${line.full}`}>
        SwapUp grade: {line.text}
        {line.provisional ? <Text style={{ color: L.warn }}> · provisional</Text> : null}
      </Text>
      {g.why ? <Small>{g.why}</Small> : null}
      {note ? <Small color={L.ink}>{note}</Small> : null}
      {canReport || canPull ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 20 }}>
          {canReport ? <TextLink title="View report" onPress={onView} /> : null}
          {canReport ? <TextLink title="Show to customer" onPress={onShow} /> : null}
          {canPull ? <TextLink title={pulling ? "Getting Phonecheck results…" : "Get Phonecheck results"} onPress={onPull} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

/** One thing the answer still needs. Its title and text are dropped where the headline and the sentence already say them. */
function AskCard({
  ask,
  headline,
  reason,
  variant,
  measuredStorage,
  handoff,
  onVariant,
  onSheet,
  onFull,
}: {
  ask: OfferAsk;
  headline: string;
  reason: string | null;
  variant: string | null;
  /** The case's measured size (CaseView.measuredStorage): a storage ask without chips sends it to the desk's answer card. */
  measuredStorage: string | null;
  handoff: boolean;
  onVariant: (v: string) => void;
  onSheet: (s: SheetName) => void;
  /** Hand off to the full case, at this anchor ("" or "#step-…"). */
  onFull: (hash: string) => void;
}) {
  const btn = (title: string, onPress: () => void, busy?: boolean) => <Btn title={title} kind="secondary" busy={busy} onPress={onPress} style={{ alignSelf: "flex-start" }} />;
  let control: React.ReactNode = null;
  switch (ask.kind) {
    case "storage": {
      // No chip can be right when the phone measured a size that isn't on file: the desk takes that one.
      const go = storageHandoff({ measuredStorage });
      control = (
        <>
          {ask.options.length ? (
            <Segmented options={ask.options.map((x) => ({ value: x.variant, label: chipLabel(x) }))} value={variant ?? ""} onChange={onVariant} />
          ) : (
            btn(go.title, () => onFull(go.hash), handoff)
          )}
          {/* The server's one note under the chips (e.g. how old PriceIQ's prices are), as sent. */}
          {ask.note ? (
            <Small color={L.warn} weight="600">
              {ask.note}
            </Small>
          ) : null}
        </>
      );
      break;
    }
    case "partner_quote":
      // No partner price yet, or a quote typed from the partner's app that has expired: either way, today's goes in here.
      control = btn("Enter the partner's quote", () => onSheet("partner"));
      break;
    case "repair_quote":
      control = btn("Enter the repair quote", () => onSheet("refurb"));
      break;
    case "new_phone":
      control = btn(CHOOSE_PHONE, () => onSheet("phone"));
      break;
    case "model":
      control = btn("Choose the model", () => onFull("#step-phone"), handoff);
      break;
    case "blocked":
      // A store manager resolves it on the desk.
      control = btn("Open full case", () => onFull(""), handoff);
      break;
  }
  return (
    <Card style={{ gap: 12 }}>
      {ask.title !== headline ? <H2>{ask.title}</H2> : null}
      {ask.text !== reason ? <Body muted>{ask.text}</Body> : null}
      {control}
    </Card>
  );
}

/**
 * One of the two numbers. Grows to half the row and may shrink below its content (minWidth 0),
 * so both stay side by side at 375 px. The chosen one has a 2 px ink outline; a refused one
 * can't be chosen (its reason is in it). The small "Recommended" is primary blue, never green.
 */
function Tile({
  label,
  selected,
  disabled,
  recommended,
  wide,
  onPress,
  children,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  recommended: boolean;
  wide: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
        gap: 6,
        padding: wide ? 20 : 14,
        borderRadius: 22,
        borderWidth: 2,
        // A tile the customer can't choose reads as a note, not a choice: no white card, a quiet
        // outline. Its links (Change, Choose the new phone) still work, and it says why below.
        borderColor: selected ? L.ink : disabled ? L.border : "transparent",
        backgroundColor: disabled ? "transparent" : pressed ? L.surface2 : L.surface,
      })}
    >
      {recommended ? <Text style={{ color: L.primary, fontSize: 13, fontWeight: "700" }}>Recommended</Text> : null}
      <Label>{label}</Label>
      {children}
    </Pressable>
  );
}

function NothingToRepair({ wide }: { wide: boolean }) {
  const face = useHead("800");
  return <Text style={[{ color: L.ink, fontSize: wide ? 26 : 20, lineHeight: wide ? 32 : 25 }, face]}>Nothing to repair</Text>;
}

function Small({ children, color = L.muted, weight }: { children: React.ReactNode; color?: string; weight?: "600" | "700" }) {
  return <Text style={{ color, fontSize: 14, lineHeight: 20, fontWeight: weight }}>{children}</Text>;
}

/**
 * How the trade-in was reached, in the server's words: its one line ("Refurbished market price
 * ₹51,399 (Good) − 2% − 2 defects · PriceIQ 2026-W35", with ", 52 days old" when the data is stale) and,
 * behind "Show details", each step with its % and rupees — the desk's same list.
 */
function TradeInHow({ d }: { d: TradeInDetail }) {
  const [open, setOpen] = useState(false);
  const more = d.lines.length > 0 || !!d.note;
  return (
    <View style={{ gap: 4 }}>
      {d.line ? <Small>{d.line}</Small> : null}
      {more ? <TextLink title={open ? "Hide details" : "Show details"} onPress={() => setOpen((x) => !x)} /> : null}
      {open && more ? (
        <View style={{ gap: 4 }}>
          {d.lines.map((l, i) => (
            <View key={`${l.label}-${i}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ flex: 1, minWidth: 0, color: L.muted, fontSize: 13, lineHeight: 18 }}>
                {l.label}
                {l.pct ? ` · ${l.pct}` : ""}
              </Text>
              <Text style={{ color: L.muted, fontSize: 13, lineHeight: 18, fontVariant: ["tabular-nums"] }}>{detailAmount(l.amount, i === 0)}</Text>
            </View>
          ))}
          {d.note ? <Text style={{ color: L.muted, fontSize: 13, lineHeight: 18 }}>{d.note}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

/** A quiet blue link inside a tile ("Change", "Cover: None · change"). */
function TextLink({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="link" style={({ pressed }) => ({ alignSelf: "flex-start", paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ color: L.primary, fontSize: 15, lineHeight: 20, fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
}
