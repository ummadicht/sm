// The Session screen — steps 2 to 4 of the store flow, REDUCED (owner, 2026-10-17: "Reduce
// the flow" — ../flow.ts holds the rules, tested under node):
//
//   1 New trade-in (./NewTradeIn): the IMEI first, then the customer →
//   2 Connect the customer's phone (Wi‑Fi + test code) →
//   3 ONE camera pass: photos + the colour sweep together (./CameraParts — the customer's phone
//     shows a code to scan, or "Take photos"; an older phone asks to be photographed after its
//     tests). "Check the phone" (./CertifyCard) sits INSIDE this step, only when the camera
//     couldn't decide →
//   4 THE ANSWER, reached by itself: once the phone's tests and the camera grade are in, the
//     server puts the results on the case (TestSessionView.autoApply — Apply's own gates still
//     decide) and this screen opens the answer (./Offer.tsx). If Apply refuses, its one-line
//     reason and a Retry; a phone that stopped mid-test can still be applied as it is.
//   5 Swap up on the answer → one "Take the trade-in" screen (./Lock.tsx).
//
// The IMEI card (./ImeiCard.tsx CaseImeiCard) tops the screen until the answer: a test the
// customer started from the counter QR had no New trade-in, so its IMEI is scanned here; after a
// store-led Start it shows what the server found (model, GSMA blacklist) and the government check
// (KYM) to send while the phone tests.
// The customer is never asked about the phone's condition: the camera checks it, and the
// advisor certifies what it couldn't, by name. The status polls every 2 s while this screen is
// up; "Open full case" (the web desk) is on the answer.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { ApiError } from "../../shared/api";
import { StaffClient, errText } from "../staffClient";
import type { SessionLinks, StaffUser, TestSessionView, WifiResponse } from "../types";
import { TERMINAL, unwrapSession } from "../types";
import { Banner, Body, Btn, Card, Chip, Columns, H2, Label, STATUS, TopBar, Tone, ago, useLayout, L } from "../ui";
import { ConnectHead, TestQrCard, WifiCard, WifiInfo } from "./SessionParts";
import { CameraStepCard, ScanStepCard } from "./CameraParts";
import { readGrading } from "../grading";
import { readPhonePhase, scanFirstNow, scanStage, sessionLayout } from "../phoneLed";
import { type CertifyRow, certifyBody, readCertify } from "../certify";
import { type AutoApply, activeStep, answerStepText, cameraOver, certifyInCamera, holdScreen, readAutoApply, sessionNow } from "../flow";
import { CheckThePhone } from "./CertifyCard";
import { CaseImeiCard } from "./ImeiCard";

const POLL_MS = 2_000;
const KEEP_AWAKE_TAG = "swapup-store-session";

type Busy = "apply" | "cancel" | "reissue" | null;

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
  imeiSkipped,
  onLinks,
  onBack,
  onSwitch,
  onOffer,
}: {
  api: StaffClient;
  user: StaffUser;
  id: string;
  links?: SessionLinks;
  /** New trade-in skipped the IMEI: its card starts folded ("Scan now" opens it). */
  imeiSkipped?: boolean;
  /** Remember the links the server returned (join URL, Wi‑Fi) for this session. */
  onLinks: (links: SessionLinks) => void;
  onBack: () => void;
  /** A reissue that produced a different session id. */
  onSwitch: (id: string, links: SessionLinks) => void;
  /** The results are on the case: show the answer (./Offer.tsx). */
  onOffer: (caseId: string, ref: string) => void;
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
          if (!nv) throw new Error("Bad answer from the server. Retrying…");
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
            setLoadErr(e.status === 404 ? "This test no longer exists." : errText(e));
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

  // Step 4 by itself: the moment the results are on the case, the answer opens. Its Back goes Home.
  const opened = useRef(false);
  useEffect(() => {
    if (!v || v.status !== "applied" || opened.current) return;
    opened.current = true;
    onOffer(v.caseId, v.caseRef);
  }, [v, onOffer]);

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
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {
        /* not fatal */
      });
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
    return {
      session: sv,
      joinUrl: typeof o.joinUrl === "string" ? o.joinUrl : `${api.base}/j/${sv.code}`,
      deepLink: o.deepLink,
      downloadUrl: o.downloadUrl,
      wifi: o.wifi ?? null,
    };
  }

  /**
   * One tap on "Check the phone": POST /api/cases/<id>/action {action: "certify"}. It answers
   * with the case; the session (its `certify`, and the answer once the last row is in) is read again at once.
   */
  async function certifyTap(row: CertifyRow, value: string): Promise<string | null> {
    if (!v) return "This test isn't loaded yet.";
    try {
      await api.post<unknown>(`/api/cases/${encodeURIComponent(v.caseId)}/action`, certifyBody(row, value, v.id));
      setPollKey((k) => k + 1);
      return null;
    } catch (e) {
      return errText(e);
    }
  }

  /** POST …/camera-override and …/release-scan answer with the session (or just its grading); the 2 s poll catches up either way. */
  function takeSession(r: unknown) {
    const nv = unwrapSession(r);
    if (nv) {
      setV(nv);
      terminalRef.current = TERMINAL.has(nv.status);
      return;
    }
    const gr = r && typeof r === "object" ? (r as { grading?: unknown }).grading : undefined;
    if (gr !== undefined) setV((cur) => (cur ? { ...cur, grading: gr } : cur));
  }

  // ── actions
  /** A manual Apply: the Retry after a refusal, "Apply partial results", or an older server. */
  async function apply() {
    if (!v) return;
    setActionErr(null);
    setBusy("apply");
    try {
      const r = await api.post<{ session?: unknown; caseId?: string }>(`/api/test-sessions/${encodeURIComponent(v.id)}/apply`);
      const nv = unwrapSession(r);
      // "applied" opens the answer (the effect above).
      if (nv) setV(nv);
      else setPollKey((k) => k + 1);
    } catch (e) {
      setActionErr({ title: "Not on the case yet", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  function confirmPartial() {
    Alert.alert(
      "Apply partial results?",
      "Tests that didn't run go on as untested.",
      [
        { text: "Wait", style: "cancel" },
        { text: "Apply now", onPress: apply },
      ]
    );
  }

  async function reissue() {
    if (!v) return;
    setActionErr(null);
    setBusy("reissue");
    try {
      const r = await api.post<unknown>(`/api/test-sessions/${encodeURIComponent(v.id)}/reissue`);
      const next = takeLinks(r);
      if (!next) throw new Error("No new code came back. Try again.");
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
    Alert.alert("Cancel this test?", "The code stops working for good.", [
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
  const grading = readGrading(v);
  const layout = sessionLayout(v, grading);
  const phoneLed = layout === "scanFirst";
  const phase = readPhonePhase(v).phase;
  const stage = scanStage({
    grading: grading.phase,
    phase,
    status: v.status,
    deviceReady: grading.deviceReady,
    photosDone: grading.photosDone,
    screenDone: grading.screenDone,
  });
  const auto = readAutoApply(v);
  const certify = readCertify(v);
  const cameraOff = grading.phase === "absent" || grading.phase === "disabled" || grading.phase === "failed";
  const certifyShown =
    !terminal &&
    certifyInCamera(certify, {
      cameraOver: cameraOver({ layout, stage, status: v.status, cameraOff, photosDone: grading.photosDone, screenDone: grading.screenDone }),
      gradePending: grading.gradePending,
    });
  const joined = v.status === "joined" || v.status === "testing" || v.status === "complete";
  const cameraNow =
    certifyShown || (phoneLed ? stage === "now" || stage === "setup" || (joined && stage === "waiting") : grading.deviceReady && !grading.screenDone);
  const active = activeStep({ status: v.status, cameraNow, autoApply: auto });
  const now = sessionNow({
    status: v.status,
    caseRef: v.caseRef,
    progress: v.progress ?? null,
    joinedAt: v.joinedAt,
    layout,
    phase,
    autoApply: auto,
    certify,
    certifyShown,
    phoneLine: phoneLed && (v.status === "joined" || v.status === "testing") ? scanFirstNow(v, phase, stage) : null,
  });
  const joinUrl = joinUrlFor(v, links, api.base);
  const early = v.status === "waiting" || v.status === "opened";
  const qrVisible = early || (joined && showQr);

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
        label="A · optional"
        next="the test code"
      />
      <TestQrCard joinUrl={joinUrl} code={v.code} expiresAt={v.expiresAt} status={v.status} qrSize={qrSize} label="B" />
    </Columns>
  );

  // "Check the phone", inside step 3, only when the camera couldn't decide.
  const check =
    certifyShown && certify ? <CheckThePhone view={certify} inline holdScreen={holdScreen(certify, v.status)} onTap={certifyTap} /> : null;
  const cameraStep = phoneLed ? (
    <ScanStepCard v={v} g={grading} api={api} wide={wide} phase={phase} stage={stage} onSession={takeSession} certify={check} now={active === "camera"} />
  ) : (
    <CameraStepCard v={v} g={grading} api={api} wide={wide} onSession={takeSession} certify={check} now={active === "camera"} />
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
          {/* 1 · the IMEI, until the answer opens */}
          {!terminal ? <CaseImeiCard api={api} caseId={v.caseId} skipped={imeiSkipped} /> : null}
          {/* Where we are: one sentence */}
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Chip text={st.label} tone={st.tone} />
              {freshness ? <Text style={{ color: L.muted, fontSize: 14 }}>{freshness}</Text> : null}
            </View>
            <Text style={{ fontSize: wide ? 20 : 18, fontWeight: "700", lineHeight: wide ? 28 : 25, color: now.tone === "muted" ? L.ink : toneFg(now.tone) }}>{now.text}</Text>
            {pollFails >= 2 && pollErr && !terminal ? (
              <Banner tone="warn" title={lastOk ? `Offline · last update ${ago(new Date(lastOk).toISOString())}` : "Offline · retrying"}>
                {pollErr}
              </Banner>
            ) : null}
            {loadErr ? (
              <Banner tone="bad" title="Stopped updating" action={{ title: "Try again", onPress: () => setPollKey((k) => k + 1) }}>
                {loadErr}
              </Banner>
            ) : null}
          </Card>

          {!terminal ? (
            <>
              {/* 2 · connect */}
              <ConnectHead step="Step 2" focus={active === "connect"} live={joined} showQr={showQr} onToggleQr={() => setShowQr((x) => !x)} />
              {qrVisible ? qrCards : null}
              {/* 3 · one camera pass (and "Check the phone" inside it when the camera couldn't decide) */}
              {cameraStep}
            </>
          ) : null}

          {/* 4 · the answer, by itself */}
          <AnswerStep v={v} auto={auto} busy={busy} now={active === "answer"} onApply={apply} onPartial={confirmPartial} onAnswer={() => onOffer(v.caseId, v.caseRef)} onReissue={reissue} onBack={onBack} />
          {/* A failed Retry that only repeats step 4's own reason is not said a second time. */}
          {actionErr && !(auto?.state === "refused" && actionErr.text === auto.reason) ? <Banner tone="bad" title={actionErr.title}>{actionErr.text}</Banner> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function toneFg(t: Tone): string {
  return t === "up" ? L.up : t === "fix" ? L.fix : t === "warn" ? L.warn : t === "bad" ? L.bad : L.muted;
}

/**
 * Step 4 · The answer. It opens by itself; this card only says what it is waiting for, gives
 * Apply's reason and a Retry when it refused, lets a phone that stopped mid-test go on as it
 * is, and offers a new code or Home when the session ended.
 */
function AnswerStep({
  v,
  auto,
  busy,
  now,
  onApply,
  onPartial,
  onAnswer,
  onReissue,
  onBack,
}: {
  v: TestSessionView;
  auto: AutoApply | null;
  busy: Busy;
  now: boolean;
  onApply: () => void;
  onPartial: () => void;
  onAnswer: () => void;
  onReissue: () => void;
  onBack: () => void;
}) {
  const other = !!busy;
  const text = answerStepText(v.status, auto);
  let action: React.ReactNode = null;
  let tone: Tone = "muted";
  switch (v.status) {
    case "complete":
      if (!auto) action = <Btn title="Get the answer" onPress={onApply} busy={busy === "apply"} disabled={other && busy !== "apply"} big />;
      else if (auto.state === "refused") {
        tone = "bad";
        action = <Btn title="Retry" onPress={onApply} busy={busy === "apply"} disabled={other && busy !== "apply"} big />;
      } else action = <ActivityIndicator color={L.primary} style={{ alignSelf: "flex-start" }} accessibilityLabel="Waiting" />;
      break;
    case "joined":
    case "testing":
      // The customer stopped part-way: the advisor may still put what came in on the case.
      if ((v.progress?.done ?? 0) > 0)
        action = <Btn title="Apply partial results" kind="secondary" onPress={onPartial} busy={busy === "apply"} disabled={other && busy !== "apply"} style={{ alignSelf: "flex-start" }} />;
      break;
    case "applied":
      action = <Btn title="See the answer" onPress={onAnswer} disabled={other} big />;
      break;
    case "expired":
      action = <Btn title="New QR code" onPress={onReissue} busy={busy === "reissue"} disabled={other && busy !== "reissue"} big />;
      break;
    case "cancelled":
      action = <Btn title="Back to Home" kind="secondary" onPress={onBack} />;
      break;
  }
  return (
    <Card style={{ gap: 12, ...(now ? { borderColor: L.fix, borderWidth: 2 } : null) }}>
      <View style={{ gap: 4 }}>
        <Label style={now ? { color: L.fix } : undefined}>Step 4</Label>
        <H2>The answer</H2>
      </View>
      <Body muted={tone === "muted"} style={tone === "bad" ? { color: L.bad, fontWeight: "600" } : undefined}>
        {text}
      </Body>
      {action}
    </Card>
  );
}
