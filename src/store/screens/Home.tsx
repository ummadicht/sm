import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { StaffClient, absolute, errText } from "../staffClient";
import type { CreditState, CreditSummary, StaffUser, TestSessionView } from "../types";
import { unwrapSession } from "../types";
import { photosNeeded, readGrading } from "../grading";
import { customerStarted, readPhonePhase, scanFlag, scanStage, sessionLayout } from "../phoneLed";
import { readAutoApply } from "../flow";
import { firstName } from "../pin";
import { TEST_PROGRAMME, programmeBanner } from "../programme";
import { Banner, Body, Brand, Btn, Card, Chip, Columns, Figure, H1, H2, Label, STATUS, Tone, ago, inr, toneColor, until, useLayout, L } from "../ui";

const CREDIT_STATE: Record<CreditState, { label: string; tone: Tone }> = {
  ok: { label: "Healthy", tone: "up" },
  warn: { label: "Getting full — book a pickup", tone: "warn" },
  full: { label: "Full — no new trade-ins", tone: "bad" },
  over: { label: "Over the limit", tone: "bad" },
};

const LIST_REFRESH_MS = 10_000;

/**
 * A case still at the counter (GET /api/cases?status=draft,quoted — CaseListItem in
 * ~/projects/swapup lib/server/cases.ts). Once a test is applied the session leaves "Open
 * tests", so this list is the app's way back to the answer.
 */
type WaitingCase = { id: string; ref: string; status: string; customerName: string | null; device: string | null; updatedAt: string | null };

const CASE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Assessing", tone: "muted" },
  quoted: { label: "Quoted", tone: "fix" },
};

function readWaiting(x: unknown): WaitingCase[] {
  const list = x && typeof x === "object" ? (x as { cases?: unknown }).cases : null;
  if (!Array.isArray(list)) throw new Error("Bad case list — pull down to retry.");
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return list
    .map((c) => {
      const o = c && typeof c === "object" ? (c as Record<string, unknown>) : null;
      if (!o || typeof o.id !== "string" || typeof o.status !== "string") return null;
      return {
        id: o.id,
        ref: str(o.ref) ?? o.id,
        status: o.status,
        customerName: str(o.customerName),
        device: str(o.device),
        updatedAt: str(o.updatedAt),
      };
    })
    .filter((c): c is WaitingCase => !!c);
}

export function Home({
  api,
  user,
  onNew,
  onOpenSession,
  onOpenCase,
  onSettings,
  onOpenWeb,
  onSwitch,
}: {
  api: StaffClient;
  user: StaffUser;
  onNew: () => void;
  onOpenSession: (id: string) => void;
  /** A case waiting on the customer: open its answer. */
  onOpenCase: (caseId: string, ref: string) => void;
  onSettings: () => void;
  onOpenWeb: (url: string, title: string) => void;
  /** Store tablet only: hand the tablet to the next person (back to "Who's serving?"). */
  onSwitch?: () => void;
}) {
  const { wide, pad, content } = useLayout();
  const store = user.store!;
  const [credit, setCredit] = useState<CreditSummary | null>(null);
  const [creditErr, setCreditErr] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TestSessionView[] | null>(null);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);
  const [cases, setCases] = useState<WaitingCase[] | null>(null);
  const [casesErr, setCasesErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pickupBusy, setPickupBusy] = useState(false);
  const [pickupErr, setPickupErr] = useState<string | null>(null);
  const alive = useRef(true);

  const loadCredit = useCallback(async () => {
    try {
      const c = await api.get<CreditSummary>(`/api/stores/${encodeURIComponent(store.id)}/credit`);
      if (!alive.current) return;
      if (!c || !c.position) throw new Error("No credit line came back — pull down to retry.");
      setCredit(c);
      setCreditErr(null);
    } catch (e) {
      if (alive.current) setCreditErr(errText(e));
    }
  }, [api, store.id]);

  const loadSessions = useCallback(async () => {
    try {
      const r = await api.get<{ sessions: unknown[] }>("/api/test-sessions?open=1");
      if (!alive.current) return;
      const list = (Array.isArray(r?.sessions) ? r.sessions : Array.isArray(r) ? (r as unknown[]) : [])
        .map(unwrapSession)
        .filter((x): x is TestSessionView => !!x);
      setSessions(list);
      setSessionsErr(null);
    } catch (e) {
      if (alive.current) setSessionsErr(errText(e));
    }
  }, [api]);

  const loadCases = useCallback(async () => {
    try {
      const r = await api.get<unknown>("/api/cases?status=draft,quoted&limit=10");
      if (!alive.current) return;
      setCases(readWaiting(r));
      setCasesErr(null);
    } catch (e) {
      if (alive.current) setCasesErr(errText(e));
    }
  }, [api]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadCredit(), loadSessions(), loadCases()]);
    if (alive.current) setRefreshing(false);
  }, [loadCredit, loadSessions, loadCases]);

  useEffect(() => {
    alive.current = true;
    refresh();
    // Keep the open-tests list fresh while this screen is up and the app is in front.
    const t = setInterval(() => {
      if (AppState.currentState === "active") {
        loadSessions();
        loadCases();
      }
    }, LIST_REFRESH_MS);
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") refresh();
    });
    return () => {
      alive.current = false;
      clearInterval(t);
      sub.remove();
    };
  }, [refresh, loadSessions, loadCases]);

  async function openPickups() {
    setPickupErr(null);
    setPickupBusy(true);
    try {
      const r = await api.post<{ url: string }>("/api/auth/handoff", { next: "/store" });
      onOpenWeb(absolute(api.base, r.url), "Credit & pickups");
    } catch (e) {
      setPickupErr(errText(e));
    } finally {
      setPickupBusy(false);
    }
  }

  const approval =
    store.status === "pending" ? (
      <Banner tone="warn" title={`${store.name} is waiting for approval`}>
        Tests and quotes work; trade-ins start once approved.
      </Banner>
    ) : store.status === "rejected" ? (
      <Banner tone="bad" title={`${store.name} was not approved`}>
        {store.reviewNote || "Contact your programme for details."}
      </Banner>
    ) : null;

  // A case whose test is still open is reached through its test (above), not twice.
  const testing = new Set((sessions ?? []).map((x) => x.caseId));
  const waiting = (cases ?? []).filter((c) => !testing.has(c.id));

  const creditCard = (
    <Card>
      <Label>Trade-in credit available</Label>
      {credit ? (
        <CreditBody
          credit={credit}
          onPickups={user.role === "store_manager" ? openPickups : null}
          pickupBusy={pickupBusy}
          pickupErr={pickupErr}
        />
      ) : creditErr ? (
        <Banner tone="bad" title="Couldn't load the credit line" action={{ title: "Try again", onPress: loadCredit }}>
          {creditErr}
        </Banner>
      ) : (
        <Body muted>Loading…</Body>
      )}
    </Card>
  );

  const startCard = (
    <Card style={{ gap: 12 }}>
      <H1 style={{ fontSize: 28, lineHeight: 34 }}>Customer at the counter?</H1>
      <Body muted>Their phone tests itself in minutes.</Body>
      <Btn title="New customer trade-in" onPress={onNew} big />
    </Card>
  );

  return (
    <ScrollView
      contentContainerStyle={{ padding: pad, gap: 16, alignSelf: "center", width: content + pad * 2 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[L.primary]} tintColor={L.primary} />}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          {/* The wordmark (no logo), the store's name under it in muted text. */}
          <Brand store={[store.name, store.city, store.code].filter(Boolean).join(" · ")} />
          <Body muted style={{ fontSize: 15, lineHeight: 21 }}>
            {user.name} ({user.roleLabel})
          </Body>
          {programmeBanner(user.org) ? (
            <View style={{ marginTop: 4 }}>
              <Chip text={TEST_PROGRAMME} tone="warn" />
            </View>
          ) : null}
        </View>
        {/* Stacked on a phone so the store name keeps its width; side by side on a tablet. */}
        <View style={{ flexDirection: wide ? "row" : "column", gap: 8, alignItems: "stretch" }}>
          {onSwitch ? <Btn title={`${firstName(user.name)} · Switch`} kind="secondary" onPress={onSwitch} /> : null}
          <Btn title="Settings" kind="secondary" onPress={onSettings} />
        </View>
      </View>

      {approval}

      <Columns wide={wide}>
        {startCard}
        {creditCard}
      </Columns>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <H2>Open tests{sessions && sessions.length ? ` (${sessions.length})` : ""}</H2>
          <Text style={{ color: L.muted, fontSize: 14 }}>Pull down to refresh</Text>
        </View>
        {sessionsErr ? (
          <Banner tone="bad" title="Couldn't load open tests" action={{ title: "Try again", onPress: loadSessions }}>
            {sessionsErr}
          </Banner>
        ) : null}
        {sessions === null && !sessionsErr ? <Body muted>Loading…</Body> : null}
        {sessions && sessions.length === 0 ? <Body muted>No open tests.</Body> : null}
        {sessions?.map((x) => <SessionRow key={x.id} s={x} onPress={() => onOpenSession(x.id)} />)}
      </Card>

      {waiting.length || casesErr ? (
        <Card>
          <H2>Waiting on the customer{waiting.length ? ` (${waiting.length})` : ""}</H2>
          {casesErr ? (
            <Banner tone="bad" title="Couldn't load the cases" action={{ title: "Try again", onPress: loadCases }}>
              {casesErr}
            </Banner>
          ) : null}
          {waiting.map((c) => (
            <CaseRow key={c.id} c={c} onPress={() => onOpenCase(c.id, c.ref)} />
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}

function CreditBody({
  credit,
  onPickups,
  pickupBusy,
  pickupErr,
}: {
  credit: CreditSummary;
  /** Only a store manager can book pickups (the web page is theirs); null for an advisor. */
  onPickups: (() => void) | null;
  pickupBusy: boolean;
  pickupErr: string | null;
}) {
  const p = credit.position;
  const util = typeof p.utilisation === "number" && Number.isFinite(p.utilisation) ? p.utilisation : p.exposure > 0 ? 1 : 0;
  const pct = Math.round(util * 100);
  const st = CREDIT_STATE[p.state] ?? CREDIT_STATE.ok;
  const color = toneColor(st.tone);
  return (
    <View style={{ gap: 10 }}>
      <Figure size={44} color={p.available < 0 ? L.bad : L.ink}>
        {inr(p.available)}
      </Figure>
      <Body muted>
        {inr(p.exposure)} used of {inr(p.limit)} limit · {pct}% used
      </Body>
      <View style={{ height: 14, borderRadius: 7, backgroundColor: L.surface2, overflow: "hidden" }} accessibilityLabel={`${pct}% of the credit line used`}>
        <View style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%", backgroundColor: color, borderRadius: 7 }} />
      </View>
      <Chip text={st.label} tone={st.tone} />
      {p.state === "full" || p.state === "over" ? (
        <Body style={{ color: L.bad }}>A pickup frees the line.</Body>
      ) : null}
      {credit.advice?.due ? (
        <Banner
          tone="warn"
          title={onPickups ? "Book a pickup" : "A pickup is due"}
          action={onPickups ? { title: "Open Credit & pickups", onPress: onPickups, busy: pickupBusy } : undefined}
        >
          <View style={{ gap: 2 }}>
            {credit.advice.reasons.map((r, i) => (
              <Text key={i} style={{ fontSize: 16, color: L.text, lineHeight: 23 }}>
                • {r}
              </Text>
            ))}
            {!onPickups ? (
              <Text style={{ fontSize: 16, color: L.text, lineHeight: 23, fontWeight: "700", marginTop: 4 }}>Ask your store manager to book it.</Text>
            ) : null}
          </View>
        </Banner>
      ) : null}
      {pickupErr ? <Banner tone="bad" title="Couldn't open Credit & pickups">{pickupErr}</Banner> : null}
    </View>
  );
}

function CaseRow({ c, onPress }: { c: WaitingCase; onPress: () => void }) {
  const st = CASE_STATUS[c.status] ?? { label: c.status, tone: "muted" as Tone };
  const sub = [c.device, c.customerName, c.updatedAt ? ago(c.updatedAt) : null].filter(Boolean).join(" · ");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 14,
        paddingHorizontal: 4,
        borderTopWidth: 1,
        borderTopColor: L.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={{ fontSize: 17, fontWeight: "700", color: L.ink }} numberOfLines={1}>
          {c.ref}
        </Text>
        {sub ? (
          <Text style={{ fontSize: 15, color: L.muted }} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Chip text={st.label} tone={st.tone} />
      <Text style={{ fontSize: 24, color: L.muted }}>›</Text>
    </Pressable>
  );
}

function SessionRow({ s: x, onPress }: { s: TestSessionView; onPress: () => void }) {
  const st = STATUS[x.status] ?? { label: x.status, tone: "muted" as Tone };
  // What the advisor is needed for: the phone is showing its scan code (phone-led), photos still
  // to take (an older phone), the phone to check by eye before the answer opens, or Apply refused.
  const g = readGrading(x);
  const auto = readAutoApply(x);
  const flag =
    auto?.state === "waiting" && auto.for === "certify"
      ? { text: "Check the phone", tone: "fix" as Tone }
      : auto?.state === "refused"
        ? { text: "Not on the case", tone: "bad" as Tone }
        : sessionLayout(x, g) === "scanFirst"
          ? scanFlag(
              scanStage({ grading: g.phase, phase: readPhonePhase(x).phase, status: x.status, deviceReady: g.deviceReady, photosDone: g.photosDone, screenDone: g.screenDone })
            )
          : photosNeeded(x, x.status === "joined" || x.status === "testing" || x.status === "complete")
            ? { text: "Photos needed", tone: "warn" as Tone }
            : null;
  const model = x.summary?.model.label || [x.device?.brand, x.device?.modelName].filter(Boolean).join(" ") || null;
  const when =
    x.status === "waiting" || x.status === "opened"
      ? `Started ${ago(x.createdAt)} · code expires in ${until(x.expiresAt)}`
      : x.status === "testing"
        ? `${x.progress.done} of ${x.progress.total} tests done`
        : `Started ${ago(x.createdAt)}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 14,
        paddingHorizontal: 4,
        borderTopWidth: 1,
        borderTopColor: L.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ fontSize: 22, fontWeight: "800", letterSpacing: 3, color: L.ink, fontVariant: ["tabular-nums"], minWidth: 104 }}>{x.code}</Text>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={{ fontSize: 17, fontWeight: "700", color: L.ink }} numberOfLines={1}>
          {x.caseRef}
          {model ? ` · ${model}` : ""}
        </Text>
        <Text style={{ fontSize: 15, color: L.muted }} numberOfLines={1}>
          {when}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <Chip text={st.label} tone={st.tone} />
        {flag ? <Chip text={flag.text} tone={flag.tone} /> : null}
        {customerStarted(x) ? <Chip text="Started by the customer" tone="muted" /> : null}
        {/* No New trade-in on this path: the IMEI card tops its Session screen. */}
        {customerStarted(x) && (x.status === "waiting" || x.status === "opened" || x.status === "joined") ? (
          <Btn title="Scan IMEI" kind="secondary" onPress={onPress} />
        ) : null}
      </View>
      <Text style={{ fontSize: 24, color: L.muted }}>›</Text>
    </Pressable>
  );
}
