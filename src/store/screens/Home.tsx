import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { L } from "../../shared/theme";
import { StaffClient, absolute, errText } from "../staffClient";
import type { CreditState, CreditSummary, StaffUser, TestSessionView } from "../types";
import { unwrapSession } from "../types";
import { photosNeeded } from "../grading";
import { Banner, Body, Btn, Card, Chip, Columns, H1, H2, Label, STATUS, Tone, ago, inr, toneColor, until, useLayout } from "../ui";

const CREDIT_STATE: Record<CreditState, { label: string; tone: Tone }> = {
  ok: { label: "Healthy", tone: "up" },
  warn: { label: "Getting full — book a pickup", tone: "warn" },
  full: { label: "Full — no new trade-ins", tone: "bad" },
  over: { label: "Over the limit", tone: "bad" },
};

const LIST_REFRESH_MS = 10_000;

export function Home({
  api,
  user,
  onNew,
  onOpenSession,
  onSettings,
  onOpenWeb,
}: {
  api: StaffClient;
  user: StaffUser;
  onNew: () => void;
  onOpenSession: (id: string) => void;
  onSettings: () => void;
  onOpenWeb: (url: string, title: string) => void;
}) {
  const { wide, pad, content } = useLayout();
  const store = user.store!;
  const [credit, setCredit] = useState<CreditSummary | null>(null);
  const [creditErr, setCreditErr] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TestSessionView[] | null>(null);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pickupBusy, setPickupBusy] = useState(false);
  const [pickupErr, setPickupErr] = useState<string | null>(null);
  const alive = useRef(true);

  const loadCredit = useCallback(async () => {
    try {
      const c = await api.get<CreditSummary>(`/api/stores/${encodeURIComponent(store.id)}/credit`);
      if (!alive.current) return;
      if (!c || !c.position) throw new Error("The credit line came back empty. Pull down to try again.");
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

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadCredit(), loadSessions()]);
    if (alive.current) setRefreshing(false);
  }, [loadCredit, loadSessions]);

  useEffect(() => {
    alive.current = true;
    refresh();
    // Keep the open-tests list fresh while this screen is up and the app is in front.
    const t = setInterval(() => {
      if (AppState.currentState === "active") loadSessions();
    }, LIST_REFRESH_MS);
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") refresh();
    });
    return () => {
      alive.current = false;
      clearInterval(t);
      sub.remove();
    };
  }, [refresh, loadSessions]);

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
        {`${user.org?.name ?? "Your programme"} checks new stores before they can take trade-ins. Meanwhile you can test customers' phones and see quotes. Trade-ins start once the store is approved and given a credit limit.`}
      </Banner>
    ) : store.status === "rejected" ? (
      <Banner tone="bad" title={`${store.name} was not approved`}>
        {store.reviewNote || "Contact your programme for details."}
      </Banner>
    ) : null;

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
      <H2>Customer at the counter?</H2>
      <Body muted>Start a trade-in. You'll get a code for the customer to scan, and their phone tests itself in a few minutes.</Body>
      <Btn title="New customer trade-in" onPress={onNew} big />
    </Card>
  );

  return (
    <ScrollView
      contentContainerStyle={{ padding: pad, gap: 16, alignSelf: "center", width: content + pad * 2 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[L.up]} />}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <H1>{store.name}</H1>
          <Body muted>
            {[store.city, store.code].filter(Boolean).join(" · ")}
            {"  ·  "}
            {user.name} ({user.roleLabel})
          </Body>
          {user.org?.demo ? (
            <View style={{ marginTop: 4 }}>
              <Chip text="Demo programme — sample data" tone="warn" />
            </View>
          ) : null}
        </View>
        <Btn title="Settings" kind="secondary" onPress={onSettings} />
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
        {sessions && sessions.length === 0 ? <Body muted>No open tests. Tap “New customer trade-in” to start one.</Body> : null}
        {sessions?.map((x) => <SessionRow key={x.id} s={x} onPress={() => onOpenSession(x.id)} />)}
      </Card>
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
      <Text style={{ fontSize: 44, fontWeight: "800", color: p.available < 0 ? L.bad : L.ink, letterSpacing: -1 }}>{inr(p.available)}</Text>
      <Body muted>
        {inr(p.exposure)} used of {inr(p.limit)} limit · {pct}% used
      </Body>
      <View style={{ height: 14, borderRadius: 7, backgroundColor: L.surface2, overflow: "hidden" }} accessibilityLabel={`${pct}% of the credit line used`}>
        <View style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%", backgroundColor: color, borderRadius: 7 }} />
      </View>
      <Chip text={st.label} tone={st.tone} />
      {p.state === "full" || p.state === "over" ? (
        <Body style={{ color: L.bad }}>New trade-ins can't be locked until a pickup frees the line. Phone tests still work.</Body>
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

function SessionRow({ s: x, onPress }: { s: TestSessionView; onPress: () => void }) {
  const st = STATUS[x.status] ?? { label: x.status, tone: "muted" as Tone };
  // Joined but no camera grade yet (and camera grading is on): the advisor still has step 3 to do.
  const needPhotos = photosNeeded(x, x.status === "joined" || x.status === "testing" || x.status === "complete");
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
        {needPhotos ? <Chip text="Photos needed" tone="warn" /> : null}
      </View>
      <Text style={{ fontSize: 24, color: L.muted }}>›</Text>
    </Pressable>
  );
}
