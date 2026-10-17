// The heart of the store app: the two QR codes the customer scans, then their
// phone's results landing live (poll every 2 s while this screen is up), then
// Apply to case → Continue pricing in the web desk.
//
// With a two-pass server (docs/TWO-PASS-CAMERA.md, 2026-10-17) the screen reads
// top to bottom in the order the counter works:
//   1 Photograph the phone (photosUrl, at once — or skip) → 2 Connect the customer's
//   phone (Wi‑Fi + test QR) → 3 The phone tests itself → 4 Check the screen
//   (screenUrl, after the tests) → 5 Apply to case → Continue pricing.
// An older server (no photosUrl) keeps the one-pass layout: QR codes, then step 3
// "Photograph the phone" with the single cameraUrl.
//
// The phone-led flow (docs/PHONE-LED-FLOW.md, SwapUp Check 0.6.0+ — ../phoneLed.ts
// decides when it applies) follows the customer's phone instead:
//   1 Connect the customer's phone (Wi‑Fi + test QR) → 2 Identify the phone (what the
//   customer confirmed or picked, IMEI 1/2) → 3 Scan the customer's phone (its QR,
//   with this tablet's camera app — or Take photos) → 4 The phone tests itself
//   (+ battery health) → 5 Apply to case → Continue pricing.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { ApiError } from "../../shared/api";
import { L } from "../../shared/theme";
import { StaffClient, absolute, errText } from "../staffClient";
import type { SessionLinks, StaffUser, TestSessionView, WifiResponse } from "../types";
import { TERMINAL, unwrapSession } from "../types";
import { Banner, Body, Btn, Card, Chip, Columns, Label, STATUS, TopBar, Tone, ago, useLayout } from "../ui";
import {
  ConnectHead,
  DeclaredCard,
  DeviceCard,
  IdentifyStepCard,
  ScanFirstStepper,
  Stepper,
  SummaryCard,
  TestQrCard,
  TestsCard,
  TestsStepCard,
  WifiCard,
  WifiInfo,
  nowLine,
} from "./SessionParts";
import { CameraAiCard, CameraStepCard, PhotosStepCard, ScanStepCard, ScreenStepCard } from "./CameraParts";
import { CameraGrading, PhotosStep, photosStep, readGrading } from "../grading";
import { Layout, readPhonePhase, scanFirstNow, scanStage, sessionLayout } from "../phoneLed";

const POLL_MS = 2_000;
const KEEP_AWAKE_TAG = "swapup-store-session";

/**
 * Sessions whose photos the advisor skipped. "Skip photos" records nothing on the
 * server (the case simply has no camera grade), so it is remembered only for this
 * run of the app — enough that coming back to the session doesn't ask again.
 */
const photosSkipped = new Set<string>();

/** Two passes: what the ADVISOR does now, when that isn't just "wait for the customer's phone". */
function advisorNext(v: TestSessionView, g: CameraGrading, photos: PhotosStep): { text: string; tone: Tone } | null {
  const early = v.status === "waiting" || v.status === "opened";
  if (early && photos === "todo") return { text: "First, photograph the phone (step 1). Then turn the tablet to the customer.", tone: "fix" };
  const open = v.status === "joined" || v.status === "testing" || v.status === "complete";
  if (open && g.deviceReady && !g.screenDone && !!g.screenUrl)
    return { text: "The customer's phone is on its photo screen — check the screen now (step 4).", tone: "fix" };
  return null;
}

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
  const [skipped, setSkipped] = useState(() => photosSkipped.has(id));
  const skipPhotos = useCallback(
    (skip: boolean) => {
      if (skip) photosSkipped.add(id);
      else photosSkipped.delete(id);
      setSkipped(skip);
    },
    [id]
  );

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
    const next: SessionLinks = {
      session: sv,
      joinUrl: typeof o.joinUrl === "string" ? o.joinUrl : `${api.base}/j/${sv.code}`,
      deepLink: o.deepLink,
      downloadUrl: o.downloadUrl,
      wifi: o.wifi ?? null,
    };
    return next;
  }

  /** POST …/camera-override answers with the session (or just its grading); the 2 s poll catches up either way. */
  function takeOverride(r: unknown) {
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
  const grading = readGrading(v);
  const layout = sessionLayout(v, grading);
  const twoPass = layout === "twoPass";
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
  const photos = photosStep(grading, skipped);
  const now =
    (phoneLed && !terminal ? scanFirstNow(v, phase, stage) : null) ?? (twoPass && !terminal ? advisorNext(v, grading, photos) : null) ?? nowLine(v);
  const joinUrl = joinUrlFor(v, links, api.base);
  const early = v.status === "waiting" || v.status === "opened";
  const live = v.status === "joined" || v.status === "testing" || v.status === "complete";
  const qrVisible = early || (live && showQr);
  const hasResults = !!v.device || Object.keys(v.results ?? {}).length > 0 || !!v.declared || !early;

  // Two columns on a tablet: each QR fills its card; on a phone one QR fills the width.
  const colW = wide ? (content - 16) / 2 : content;
  const qrSize = Math.round(Math.max(180, Math.min(wide ? 340 : 320, colW - 40)));

  // Two passes: the codes are labelled A / B under step 2, so the customer reads
  // "Wi‑Fi, then the test" and the advisor's numbered steps stay 1–5.
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
        {...(twoPass || phoneLed ? { label: "A · optional", next: "the test code" } : null)}
      />
      <TestQrCard joinUrl={joinUrl} code={v.code} expiresAt={v.expiresAt} status={v.status} qrSize={qrSize} {...(twoPass || phoneLed ? { label: "B" } : null)} />
    </Columns>
  );

  const cameraStep = !terminal && layout === "onePass" ? <CameraStepCard v={v} g={grading} api={api} wide={wide} onSession={takeOverride} /> : null;
  // Step 2 is the advisor's job once the photos are out of the way: taken, skipped, or impossible here.
  const connectNow = photos === "done" || photos === "skipped" || photos === "none";
  // No LCD verdict yet is not a finding while the screen check is still to come.
  const screenDue = !terminal && (phoneLed ? stage === "setup" || stage === "waiting" || stage === "now" : twoPass && !grading.screenDone);
  const cameraAi = <CameraAiCard g={grading} screenDue={screenDue} photosSkipped={phoneLed ? stage === "skipped" : skipped} flow={layout} />;
  // Phone-led: the damage questions are the browser check's only; the IMEIs live in "Identify the phone".
  const declaredCard =
    !phoneLed ? (
      <DeclaredCard v={v} />
    ) : v.declared && [v.declared.screenCracked, v.declared.backCracked, v.declared.liquid].some((x) => x !== null && x !== undefined) ? (
      <DeclaredCard v={v} withImei={false} />
    ) : null;
  // Once the session has ended the steps go, but what the phone said it was stays in view.
  const identityCard = phoneLed && terminal && v.device ? <IdentifyStepCard v={v} api={api} phase={phase} label="Customer's phone" /> : null;

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
            {phoneLed ? <ScanFirstStepper v={v} phase={phase} wide={wide} /> : <Stepper v={v} wide={wide} />}
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

          {phoneLed && !terminal ? (
            <>
              {/* 1 → 5, top to bottom, in the order the customer's phone goes */}
              <ConnectHead step="Step 1" phoneLed focus live={live} showQr={showQr} onToggleQr={() => setShowQr((x) => !x)} />
              {qrVisible ? qrCards : null}
              <IdentifyStepCard v={v} api={api} phase={phase} />
              <ScanStepCard v={v} g={grading} api={api} wide={wide} phase={phase} stage={stage} onSession={takeOverride} />
              <TestsStepCard v={v} label="Step 4 · customer's phone" phoneLed phase={phase} />
              <Actions v={v} busy={busy} onApply={confirmApply} onContinue={continuePricing} onReissue={reissue} onBack={onBack} layout={layout} />
              {actionErr ? <Banner tone="bad" title={actionErr.title}>{actionErr.text}</Banner> : null}
            </>
          ) : twoPass && !terminal ? (
            <>
              {/* 1 → 2 → 3 → 4 → 5, top to bottom, in the order the counter works */}
              <PhotosStepCard v={v} g={grading} api={api} wide={wide} skipped={skipped} onSkip={skipPhotos} onSession={takeOverride} />
              <ConnectHead focus={connectNow} live={live} showQr={showQr} onToggleQr={() => setShowQr((x) => !x)} />
              {qrVisible ? qrCards : null}
              <TestsStepCard v={v} />
              <ScreenStepCard v={v} g={grading} api={api} wide={wide} onSession={takeOverride} />
              <Actions
                v={v}
                busy={busy}
                onApply={confirmApply}
                onContinue={continuePricing}
                onReissue={reissue}
                onBack={onBack}
                layout={layout}
              />
              {actionErr ? <Banner tone="bad" title={actionErr.title}>{actionErr.text}</Banner> : null}
            </>
          ) : (
            <>
              {/* What to do next */}
              <Actions
                v={v}
                busy={busy}
                onApply={confirmApply}
                onContinue={continuePricing}
                onReissue={reissue}
                onBack={onBack}
                layout={layout}
              />
              {actionErr ? <Banner tone="bad" title={actionErr.title}>{actionErr.text}</Banner> : null}

              {/* ③ once the customer's phone is in: the advisor's next job */}
              {live ? cameraStep : null}

              {/* The two QR codes (③ sits in a row below them until the phone joins) */}
              {qrVisible ? qrCards : null}
              {!live ? cameraStep : null}
              {live ? (
                <Btn
                  title={showQr ? "Hide the QR codes" : "Show the QR codes again"}
                  kind="ghost"
                  onPress={() => setShowQr((x) => !x)}
                  style={{ alignSelf: "flex-start" }}
                />
              ) : null}
            </>
          )}

          {/* Results as they land */}
          {hasResults ? (
            wide ? (
              <Columns wide>
                <View style={{ gap: 16 }}>
                  <SummaryCard v={v} />
                  {cameraAi}
                  {identityCard}
                  <DeviceCard v={v} />
                  {declaredCard}
                </View>
                <TestsCard v={v} />
              </Columns>
            ) : (
              <View style={{ gap: 16 }}>
                <SummaryCard v={v} />
                {cameraAi}
                {identityCard}
                <DeviceCard v={v} />
                <TestsCard v={v} />
                {declaredCard}
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
  layout,
}: {
  v: TestSessionView;
  busy: Busy;
  onApply: (partial: boolean) => void;
  onContinue: () => void;
  onReissue: () => void;
  onBack: () => void;
  /**
   * Two passes: this card is step 5, and Apply may be waiting on the screen check (step 4).
   * Phone-led: step 5 too, and the camera grade is usually final before the tests finish.
   */
  layout: Layout;
}) {
  const other = !!busy;
  const twoPass = layout === "twoPass";
  switch (v.status) {
    case "complete": {
      // The screen check is the phone's last step: the camera's verdict usually lands 8–30 s after it says "complete".
      const g = readGrading(v);
      const waiting = g.gradePending;
      return (
        <Card style={{ gap: 12 }}>
          {layout !== "onePass" ? <Label>Step 5 · advisor</Label> : null}
          <Body>
            {waiting
              ? twoPass && !g.screenDone
                ? "Apply waits for the camera — the screen check (step 4) hasn't run yet, or the grade is still being worked out. It unlocks by itself within 3 minutes of the photos."
                : "The store camera's grade is still being worked out — usually under 30 seconds. Apply unlocks by itself."
              : `Check the summary below, then put the results on case ${v.caseRef}. The repair quote and trade-in price update from them.`}
          </Body>
          <Btn title={waiting ? (twoPass && !g.screenDone ? "Waiting for the camera…" : "Waiting for the camera grade…") : "Apply to case"} onPress={() => onApply(false)} busy={busy === "apply"} disabled={waiting || (other && busy !== "apply")} big />
        </Card>
      );
    }
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
