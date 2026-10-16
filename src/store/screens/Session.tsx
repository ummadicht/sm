// The heart of the store app: the two QR codes the customer scans, then their
// phone's results landing live (poll every 2 s while this screen is up), then
// Apply to case → Continue pricing in the web desk.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { ApiError } from "../../shared/api";
import { L } from "../../shared/theme";
import { StaffClient, absolute, errText } from "../staffClient";
import type { SessionLinks, StaffUser, TestSessionView, WifiResponse } from "../types";
import { TERMINAL, unwrapSession } from "../types";
import { Banner, Body, Btn, Card, Chip, Columns, STATUS, TopBar, Tone, ago, useLayout } from "../ui";
import { DeclaredCard, DeviceCard, Stepper, SummaryCard, TestQrCard, TestsCard, WifiCard, WifiInfo, nowLine } from "./SessionParts";

const POLL_MS = 2_000;
const KEEP_AWAKE_TAG = "swapup-store-session";

type Busy = "apply" | "cancel" | "reissue" | "handoff" | null;

/** The link the test QR encodes. The server's own joinUrl when we have it for this code, else <server>/j/<code>. */
function joinUrlFor(v: TestSessionView, links: SessionLinks | undefined, apiBase: string): string {
  const own = (v as unknown as { joinUrl?: unknown }).joinUrl;
  if (typeof own === "string" && own) return own;
  if (links?.joinUrl) {
    if (links.joinUrl.endsWith(`/${v.code}`)) return links.joinUrl;
    const m = /^(.*)\/j\/[^/]+$/.exec(links.joinUrl);
    if (m) return `${m[1]}/j/${v.code}`;
  }
  return `${apiBase}/j/${v.code}`;
}

export function SessionScreen({
  api,
  user,
  id,
  links: initialLinks,
  onLinks,
  onBack,
  onSwitch,
  onOpenWeb,
}: {
  api: StaffClient;
  user: StaffUser;
  id: string;
  links?: SessionLinks;
  /** Remember the links the server returned (join URL, Wi‑Fi) for this session. */
  onLinks: (links: SessionLinks) => void;
  onBack: () => void;
  /** A reissue that produced a different session id. */
  onSwitch: (id: string, links: SessionLinks) => void;
  onOpenWeb: (url: string, title: string) => void;
}) {
  const { wide, pad, content } = useLayout();
  const store = user.store!;
  const canEditWifi = user.role === "store_manager" || user.role === "org_admin";

  const [links, setLinks] = useState<SessionLinks | undefined>(initialLinks);
  const [v, setV] = useState<TestSessionView | null>(initialLinks?.session ?? null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pollFails, setPollFails] = useState(0);
  const [pollErr, setPollErr] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(initialLinks ? Date.now() : null);
  const [pollKey, setPollKey] = useState(0);
  const [, setTick] = useState(0);

  const [wifi, setWifi] = useState<WifiInfo | null | undefined>(initialLinks?.wifi ? { ...initialLinks.wifi } : undefined);
  const [wifiErr, setWifiErr] = useState<string | null>(null);

  const [busy, setBusy] = useState<Busy>(null);
  const [actionErr, setActionErr] = useState<{ title: string; text: string } | null>(null);
  const [appliedCaseId, setAppliedCaseId] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  const status = v?.status;
  const terminal = status ? TERMINAL.has(status) : false;
  const terminalRef = useRef(terminal);
  terminalRef.current = terminal;

  // ── live status: poll every 2 s while this screen is up, the app is in front, and the session is still open
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!alive) return;
      if (AppState.currentState === "active") {
        try {
          const r = await api.get<unknown>(`/api/test-sessions/${encodeURIComponent(id)}`);
          if (!alive) return;
          const nv = unwrapSession(r);
          if (!nv) throw new Error("The server's answer about this test didn't make sense. Retrying…");
          setV(nv);
          terminalRef.current = TERMINAL.has(nv.status);
          setLoadErr(null);
          setPollErr(null);
          setPollFails(0);
          setLastOk(Date.now());
        } catch (e) {
          if (!alive) return;
          if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
            // Gone or not ours: polling again won't fix it.
            setLoadErr(e.status === 404 ? "This test session no longer exists on the server." : errText(e));
            return;
          }
          setPollErr(errText(e));
          setPollFails((n) => n + 1);
        }
      }
      if (!alive || terminalRef.current) return;
      timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [api, id, pollKey]);

  // "updated 4 s ago" stays honest without a fetch.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5_000);
    return () => clearInterval(t);
  }, []);

  // Keep the tablet's screen on while a customer is mid-test.
  useEffect(() => {
    if (terminal) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      try {
        deactivateKeepAwake(KEEP_AWAKE_TAG);
      } catch {
        /* not fatal */
      }
    };
  }, [terminal]);

  // ── store Wi‑Fi (full record, so a manager can edit it)
  const loadWifi = useCallback(async () => {
    setWifiErr(null);
    try {
      const r = await api.get<WifiResponse>(`/api/stores/${encodeURIComponent(store.id)}/wifi`);
      setWifi(r?.wifi && r.qr ? { ...r.wifi, qr: r.qr } : null);
    } catch (e) {
      // Whatever the create call gave us stays on screen; the card shows the error only when there's nothing.
      setWifiErr(errText(e));
    }
  }, [api, store.id]);
  useEffect(() => {
    loadWifi();
  }, [loadWifi]);

  function takeLinks(r: unknown): SessionLinks | null {
    const sv = unwrapSession(r);
    if (!sv) return null;
    const o = r as Partial<SessionLinks>;
    const next: SessionLinks = {
      session: sv,
      joinUrl: typeof o.joinUrl === "string" ? o.joinUrl : `${api.base}/j/${sv.code}`,
      deepLink: o.deepLink,
      downloadUrl: o.downloadUrl,
      wifi: o.wifi ?? null,
    };
    return next;
  }

  // ── actions
  async function apply() {
    if (!v) return;
    setActionErr(null);
    setBusy("apply");
    try {
      const r = await api.post<{ session?: unknown; caseId?: string }>(`/api/test-sessions/${encodeURIComponent(v.id)}/apply`);
      const nv = unwrapSession(r);
      if (nv) {
        setV(nv);
        terminalRef.current = TERMINAL.has(nv.status);
      }
      setAppliedCaseId(r?.caseId || nv?.caseId || v.caseId);
    } catch (e) {
      setActionErr({ title: "Not applied", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  function confirmApply(partial: boolean) {
    if (!partial) return apply();
    Alert.alert(
      "Apply the results so far?",
      "The customer hasn't finished. Tests that didn't run go on the case as untested — never as passed. Check those by hand.",
      [
        { text: "Wait for the customer", style: "cancel" },
        { text: "Apply now", onPress: apply },
      ]
    );
  }

  async function continuePricing() {
    if (!v) return;
    const caseId = appliedCaseId || v.caseId;
    setActionErr(null);
    setBusy("handoff");
    try {
      const r = await api.post<{ url?: string }>("/api/auth/handoff", { next: `/cases/${caseId}` });
      if (!r?.url) throw new Error("The server didn't return a link to the case. Try again.");
      onOpenWeb(absolute(api.base, r.url), `Case ${v.caseRef}`);
    } catch (e) {
      setActionErr({ title: "Couldn't open the case", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  async function reissue() {
    if (!v) return;
    setActionErr(null);
    setBusy("reissue");
    try {
      const r = await api.post<unknown>(`/api/test-sessions/${encodeURIComponent(v.id)}/reissue`);
      const next = takeLinks(r);
      if (!next) throw new Error("The server didn't return a new code. Try again.");
      onLinks(next);
      if (next.session.id !== v.id) {
        onSwitch(next.session.id, next);
        return;
      }
      setLinks(next);
      setV(next.session);
      terminalRef.current = TERMINAL.has(next.session.status);
      if (next.wifi && wifi === undefined) setWifi({ ...next.wifi });
      setShowQr(false);
      setPollKey((k) => k + 1);
    } catch (e) {
      setActionErr({ title: "No new code", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!v) return;
    setActionErr(null);
    setBusy("cancel");
    try {
      const r = await api.post<unknown>(`/api/test-sessions/${encodeURIComponent(v.id)}/cancel`);
      const nv = unwrapSession(r);
      if (nv) {
        setV(nv);
        terminalRef.current = TERMINAL.has(nv.status);
      } else {
        setV({ ...v, status: "cancelled" });
        terminalRef.current = true;
      }
    } catch (e) {
      setActionErr({ title: "Not cancelled", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  function confirmCancel() {
    Alert.alert("Cancel this test?", "The code stops working and the customer's app can't send any more results. You can't undo this.", [
      { text: "Keep it", style: "cancel" },
      { text: "Cancel the test", style: "destructive", onPress: cancel },
    ]);
  }

  // ── first load
  if (!v) {
    return (
      <View style={{ flex: 1 }}>
        <TopBar title="Trade-in test" left={{ label: "‹ Home", onPress: onBack }} />
        <View style={{ padding: pad, gap: 16, alignSelf: "center", width: Math.min(content + pad * 2, 640) }}>
          {loadErr || pollErr ? (
            <Banner tone="bad" title="Couldn't load this test" action={{ title: "Try again", onPress: () => setPollKey((k) => k + 1) }}>
              {loadErr || pollErr || ""}
            </Banner>
          ) : (
            <Body muted>Loading…</Body>
          )}
        </View>
      </View>
    );
  }

  const st = STATUS[v.status] ?? { label: v.status, tone: "muted" as Tone };
  const now = nowLine(v);
  const joinUrl = joinUrlFor(v, links, api.base);
  const early = v.status === "waiting" || v.status === "opened";
  const live = v.status === "joined" || v.status === "testing" || v.status === "complete";
  const qrVisible = early || (live && showQr);
  const hasResults = !!v.device || Object.keys(v.results ?? {}).length > 0 || !!v.declared || !early;

  // Two columns on a tablet: each QR fills its card; on a phone one QR fills the width.
  const colW = wide ? (content - 16) / 2 : content;
  const qrSize = Math.round(Math.max(180, Math.min(wide ? 340 : 320, colW - 40)));

  const qrCards = (
    <Columns wide={wide}>
      <WifiCard
        api={api}
        storeId={store.id}
        wifi={wifi}
        wifiErr={wifiErr}
        canEdit={canEditWifi}
        qrSize={qrSize}
        onSaved={(w) => setWifi(w)}
        onRetry={loadWifi}
      />
      <TestQrCard joinUrl={joinUrl} code={v.code} expiresAt={v.expiresAt} status={v.status} qrSize={qrSize} />
    </Columns>
  );

  const freshness =
    terminal ? null : pollFails >= 2 && pollErr ? null : lastOk ? `Live · updated ${ago(new Date(lastOk).toISOString()) || "just now"}` : "Connecting…";

  return (
    <View style={{ flex: 1 }}>
      <TopBar
        title={`Trade-in ${v.caseRef}`}
        subtitle={`Code ${v.code} · ${st.label}`}
        left={{ label: "‹ Home", onPress: onBack }}
        right={!terminal ? <Btn title="Cancel test" kind="danger" onPress={confirmCancel} busy={busy === "cancel"} disabled={!!busy && busy !== "cancel"} /> : undefined}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: pad, gap: 16, alignSelf: "center", width: content + pad * 2 }} keyboardShouldPersistTaps="handled">
          {/* Where we are */}
          <Card style={{ gap: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Chip text={st.label} tone={st.tone} />
              {freshness ? <Text style={{ color: L.muted, fontSize: 14 }}>{freshness}</Text> : null}
            </View>
            <Stepper v={v} wide={wide} />
            <Text style={{ fontSize: wide ? 20 : 18, fontWeight: "700", lineHeight: wide ? 28 : 25, color: now.tone === "muted" ? L.ink : toneFg(now.tone) }}>{now.text}</Text>
            {pollFails >= 2 && pollErr && !terminal ? (
              <Banner tone="warn" title="Lost contact with SwapUp — retrying every 2 seconds">
                {`${pollErr}${lastOk ? ` Last update ${ago(new Date(lastOk).toISOString())}.` : ""}`}
              </Banner>
            ) : null}
            {loadErr ? (
              <Banner tone="bad" title="Stopped updating" action={{ title: "Try again", onPress: () => setPollKey((k) => k + 1) }}>
                {loadErr}
              </Banner>
            ) : null}
          </Card>

          {/* What to do next */}
          <Actions
            v={v}
            busy={busy}
            onApply={confirmApply}
            onContinue={continuePricing}
            onReissue={reissue}
            onBack={onBack}
          />
          {actionErr ? <Banner tone="bad" title={actionErr.title}>{actionErr.text}</Banner> : null}

          {/* The two QR codes */}
          {qrVisible ? qrCards : null}
          {live ? (
            <Btn
              title={showQr ? "Hide the QR codes" : "Show the QR codes again"}
              kind="ghost"
              onPress={() => setShowQr((x) => !x)}
              style={{ alignSelf: "flex-start" }}
            />
          ) : null}

          {/* Results as they land */}
          {hasResults ? (
            wide ? (
              <Columns wide>
                <View style={{ gap: 16 }}>
                  <SummaryCard v={v} />
                  <DeviceCard v={v} />
                  <DeclaredCard v={v} />
                </View>
                <TestsCard v={v} />
              </Columns>
            ) : (
              <View style={{ gap: 16 }}>
                <SummaryCard v={v} />
                <DeviceCard v={v} />
                <TestsCard v={v} />
                <DeclaredCard v={v} />
              </View>
            )
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function toneFg(t: Tone): string {
  return t === "up" ? L.up : t === "fix" ? L.fix : t === "warn" ? L.warn : t === "bad" ? L.bad : L.muted;
}

function Actions({
  v,
  busy,
  onApply,
  onContinue,
  onReissue,
  onBack,
}: {
  v: TestSessionView;
  busy: Busy;
  onApply: (partial: boolean) => void;
  onContinue: () => void;
  onReissue: () => void;
  onBack: () => void;
}) {
  const other = !!busy;
  switch (v.status) {
    case "complete":
      return (
        <Card style={{ gap: 12 }}>
          <Body>Check the summary below, then put the results on case {v.caseRef}. The repair quote and trade-in price update from them.</Body>
          <Btn title="Apply to case" onPress={() => onApply(false)} busy={busy === "apply"} disabled={other && busy !== "apply"} big />
        </Card>
      );
    case "applied":
      return (
        <Card style={{ gap: 12 }}>
          <Body>
            The results are on case {v.caseRef}
            {v.appliedAt ? ` (applied ${new Date(v.appliedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })})` : ""}. Continue on the case to
            price the repair and the trade-in.
          </Body>
          <Btn title="Continue pricing" onPress={onContinue} busy={busy === "handoff"} disabled={other && busy !== "handoff"} big />
        </Card>
      );
    case "expired":
      return (
        <Card style={{ gap: 12 }}>
          <Body>The old code doesn't work any more. A new code keeps the same case, {v.caseRef}.</Body>
          <Btn title="New QR code" onPress={onReissue} busy={busy === "reissue"} disabled={other && busy !== "reissue"} big />
        </Card>
      );
    case "cancelled":
      return (
        <Card style={{ gap: 12 }}>
          <Body>This test was cancelled. Start a new trade-in from Home if the customer wants to try again.</Body>
          <Btn title="Back to Home" kind="secondary" onPress={onBack} />
        </Card>
      );
    case "joined":
    case "testing":
      return (v.progress?.done ?? 0) > 0 ? (
        <Card style={{ gap: 10 }}>
          <Body muted>Let the customer finish. When they do, an “Apply to case” button appears here.</Body>
          <Btn title="Apply the results so far" kind="secondary" onPress={() => onApply(true)} busy={busy === "apply"} disabled={other && busy !== "apply"} />
        </Card>
      ) : null;
    default:
      return null;
  }
}
