// The pieces of the Session screen: the two customer-facing QR cards, the
// live stepper, and the result cards (device, tests, declarations, summary).
// With a two-pass server (docs/TWO-PASS-CAMERA.md) the QR cards sit under
// step 2 "Connect the customer's phone" (ConnectHead) and step 3 shows the
// phone testing itself (TestsStepCard); the camera steps are in ./CameraParts.
// The phone-led flow (docs/PHONE-LED-FLOW.md, Check 0.6.0+) reuses them as
// step 1 (connect) and step 4 (tests), with step 2 "Identify the phone"
// (IdentifyStepCard) in between and the scan (step 3) in ./CameraParts.
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { L } from "../../shared/theme";
import { fmtBytes } from "../../shared/ui";
import { QR } from "../QR";
import { StaffClient, errText } from "../staffClient";
import type { DiagnosticSummary, Outcome, SessionStatus, TestSessionView, WifiResponse, WifiSecurity } from "../types";
import { Banner, Body, Btn, Card, Chip, Field, H2, KV, Label, Segmented, Toggle, Tone, toneColor, until } from "../ui";
import {
  BATTERY_HEALTH_MIN,
  PhonePhase,
  SCAN_FIRST_STEPS,
  batteryHealth,
  batteryLine,
  customerSays,
  customerStarted,
  imeiCheck,
  imeiMismatch,
  modelLabels,
  readCaseImeis,
  readIdentity,
  readImeiAgreement,
  scanFirstReached,
} from "../phoneLed";

export type WifiInfo = { ssid: string; qr: string; password?: string; security?: WifiSecurity; hidden?: boolean };

/** SwapUp fault ids → the words the web desk uses (lib/domain/condition.ts). */
const FAULT_LABEL: Record<string, string> = {
  screen_cracked: "Cracked screen",
  display_lines: "Lines / spots on display",
  touch_issue: "Touch not working",
  battery_drain: "Battery drains fast",
  battery_swollen: "Battery swollen",
  back_cracked: "Back glass cracked",
  frame_damage: "Bent / broken frame",
  charging_issue: "Not charging",
  rear_camera: "Rear camera faulty",
  front_camera: "Front camera faulty",
  speaker: "Speaker faulty",
  mic: "Microphone faulty",
  buttons: "Side keys faulty",
  water_damage: "Liquid damage",
  no_power: "Does not switch on",
  no_network: "No network / calls fail",
};
export const faultLabel = (id: string) => FAULT_LABEL[id] ?? id.replace(/_/g, " ");

// ── ① Join our Wi‑Fi ─────────────────────────────────────────────────────────

export function WifiCard({
  api,
  storeId,
  wifi,
  wifiErr,
  canEdit,
  qrSize,
  onSaved,
  onRetry,
  label = "Step 1 · optional",
  next = "step 2",
}: {
  api: StaffClient;
  storeId: string;
  wifi: WifiInfo | null | undefined;
  wifiErr: string | null;
  canEdit: boolean;
  qrSize: number;
  onSaved: (w: WifiInfo | null) => void;
  onRetry: () => void;
  /** The small label above the title — the numbering depends on the server's flow. */
  label?: string;
  /** What the customer goes to next without Wi‑Fi ("step 2", "the test code"). */
  next?: string;
}) {
  const [editing, setEditing] = useState(false);
  const head = (
    <View style={{ gap: 4 }}>
      <Label>{label}</Label>
      <H2>Join our Wi‑Fi</H2>
    </View>
  );

  if (editing || (wifi === null && canEdit)) {
    return (
      <Card>
        {head}
        <WifiForm
          api={api}
          storeId={storeId}
          current={wifi ?? null}
          onCancel={wifi ? () => setEditing(false) : undefined}
          onSaved={(w) => {
            setEditing(false);
            onSaved(w);
          }}
        />
      </Card>
    );
  }

  return (
    <Card style={{ alignItems: "center" }}>
      <View style={{ alignSelf: "stretch" }}>{head}</View>
      {wifi === undefined ? (
        wifiErr ? (
          <View style={{ alignSelf: "stretch" }}>
            <Banner tone="bad" title="Couldn't load the store Wi‑Fi" action={{ title: "Try again", onPress: onRetry }}>
              {wifiErr}
            </Banner>
          </View>
        ) : (
          <View style={{ width: qrSize, height: qrSize, alignItems: "center", justifyContent: "center" }}>
            <Body muted>Loading…</Body>
          </View>
        )
      ) : wifi === null ? (
        <View style={{ alignSelf: "stretch", gap: 8 }}>
          <Banner tone="muted" title="No store Wi‑Fi saved">
            Ask your manager to add the store Wi‑Fi in the app.
          </Banner>
          <Body muted>{`The customer can use mobile data instead — go straight to ${next}.`}</Body>
        </View>
      ) : (
        <>
          <Body style={{ textAlign: "center" }}>Point your camera app at this code and tap Join.</Body>
          <QR value={wifi.qr} size={qrSize} />
          <Text style={{ fontSize: 24, fontWeight: "800", color: L.ink, textAlign: "center" }} selectable>
            {wifi.ssid}
          </Text>
          {wifi.password && wifi.security !== "nopass" ? (
            <Body muted style={{ textAlign: "center" }}>
              Can't scan? Password: <Text style={{ color: L.ink, fontWeight: "800" }} selectable>{wifi.password}</Text>
            </Body>
          ) : null}
          {wifi.hidden ? <Body muted style={{ textAlign: "center" }}>Hidden network — it won't appear in the Wi‑Fi list.</Body> : null}
          <Body style={{ textAlign: "center", fontWeight: "700" }}>Already on mobile data? Skip this.</Body>
          {canEdit ? <Btn title="Change Wi‑Fi" kind="ghost" onPress={() => setEditing(true)} /> : null}
        </>
      )}
    </Card>
  );
}

export function WifiForm({
  api,
  storeId,
  current,
  onSaved,
  onCancel,
}: {
  api: StaffClient;
  storeId: string;
  current: WifiInfo | null;
  onSaved: (w: WifiInfo | null) => void;
  onCancel?: () => void;
}) {
  const [ssid, setSsid] = useState(current?.ssid ?? "");
  const [password, setPassword] = useState(current?.password ?? "");
  const [security, setSecurity] = useState<WifiSecurity>(current?.security ?? "WPA");
  const [hidden, setHidden] = useState(current?.hidden ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(clear = false) {
    setError(null);
    if (!clear) {
      if (!ssid.trim()) return setError("Enter the Wi‑Fi name exactly as it shows in the phone's Wi‑Fi list.");
      if (security !== "nopass" && !password) return setError("Enter the Wi‑Fi password, or choose “None” if the network is open.");
      if (security === "WPA" && password.length < 8) return setError("A WPA password is at least 8 characters. Check it and try again.");
    }
    setBusy(true);
    try {
      const body = clear ? { ssid: "" } : { ssid: ssid.trim(), password: security === "nopass" ? "" : password, security, hidden };
      const r = await api.post<WifiResponse>(`/api/stores/${encodeURIComponent(storeId)}/wifi`, body);
      onSaved(r?.wifi && r.qr ? { ...r.wifi, qr: r.qr } : null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 14 }}>
      <Body muted>
        {current ? "Change" : "Add"} the network customers join at this store. Every advisor's QR uses it. Use the guest network, not the one your till runs on.
      </Body>
      <Field label="Wi‑Fi name (SSID)" value={ssid} onChangeText={setSsid} autoCapitalize="none" autoCorrect={false} editable={!busy} />
      <View style={{ gap: 6 }}>
        <Text style={{ color: L.ink, fontSize: 16, fontWeight: "700" }}>Security</Text>
        <Segmented<WifiSecurity>
          value={security}
          onChange={setSecurity}
          options={[
            { value: "WPA", label: "WPA / WPA2 / WPA3" },
            { value: "WEP", label: "WEP" },
            { value: "nopass", label: "None (open)" },
          ]}
        />
      </View>
      {security !== "nopass" ? (
        <Field label="Password" value={password} onChangeText={setPassword} autoCapitalize="none" autoCorrect={false} editable={!busy} />
      ) : null}
      <Toggle label="Hidden network" hint="Only if the name doesn't appear in the Wi‑Fi list." value={hidden} onValueChange={setHidden} />
      {error ? <Banner tone="bad" title="Not saved">{error}</Banner> : null}
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <Btn title="Save Wi‑Fi" onPress={() => save(false)} busy={busy} style={{ flexGrow: 1 }} />
        {onCancel ? <Btn title="Cancel" kind="secondary" onPress={onCancel} disabled={busy} /> : null}
      </View>
      {current ? <Btn title="Remove the store Wi‑Fi" kind="ghost" onPress={() => save(true)} disabled={busy} style={{ alignSelf: "flex-start" }} /> : null}
    </View>
  );
}

// ── ② Test your phone ────────────────────────────────────────────────────────

export function TestQrCard({
  joinUrl,
  code,
  expiresAt,
  status,
  qrSize,
  label = "Step 2",
}: {
  joinUrl: string;
  code: string;
  expiresAt: string;
  status: SessionStatus;
  qrSize: number;
  label?: string;
}) {
  const steps = [
    "Open the camera and point it at this code.",
    "Tap the link that appears.",
    "Tap “Install SwapUp Check” — or “Test in this browser” (no install; the way to test an iPhone).",
    "If Android asks, allow installs from this browser: Settings → Install unknown apps → your browser → Allow.",
    "Open the app. If it asks for a code, type the big code above.",
  ];
  const left = until(expiresAt);
  return (
    <Card style={{ alignItems: "center" }}>
      <View style={{ alignSelf: "stretch", gap: 4 }}>
        <Label>{label}</Label>
        <H2>Test your phone</H2>
      </View>
      <QR value={joinUrl} size={qrSize} />
      <Text
        style={{ fontSize: 56, fontWeight: "900", letterSpacing: 10, color: L.ink, fontVariant: ["tabular-nums"], textAlign: "center" }}
        selectable
        numberOfLines={1}
        adjustsFontSizeToFit
        accessibilityLabel={`Code ${code.split("").join(" ")}`}
      >
        {code}
      </Text>
      <Text style={{ color: L.muted, fontSize: 14, textAlign: "center" }} selectable>
        {joinUrl}
      </Text>
      <View style={{ alignSelf: "stretch", gap: 8, marginTop: 4 }}>
        {steps.map((t, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: L.fixBg, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: L.fix, fontWeight: "800", fontSize: 15 }}>{i + 1}</Text>
            </View>
            <Text style={{ flex: 1, fontSize: 17, lineHeight: 24, color: L.text }}>{t}</Text>
          </View>
        ))}
      </View>
      {status === "waiting" || status === "opened" ? (
        <Text style={{ color: L.muted, fontSize: 14, alignSelf: "stretch" }}>
          {left === "now" ? "This code is about to expire." : `This code works for another ${left} unless the app connects.`}
        </Text>
      ) : null}
    </Card>
  );
}

// ── two passes: step 2 header, step 3 card ───────────────────────────────────

/**
 * Step 2 "Connect the customer's phone" — above the two QR cards. It comes AFTER
 * the photos on screen, and is emphasised once they are done or skipped; the codes
 * stay visible either way, so a customer who is ready early can still scan.
 */
export function ConnectHead({
  focus,
  live,
  showQr,
  onToggleQr,
  step = "Step 2",
  phoneLed = false,
}: {
  focus: boolean;
  live: boolean;
  showQr: boolean;
  onToggleQr: () => void;
  /** "Step 2" with photos first; "Step 1" when the phone leads (it is the first thing that happens). */
  step?: string;
  /** The phone-led flow: say what the phone does next, in its order. */
  phoneLed?: boolean;
}) {
  const now = focus && !live;
  return (
    <Card style={now ? { borderColor: L.fix, borderWidth: 2 } : undefined}>
      <View style={{ gap: 4 }}>
        <Label style={now ? { color: L.fix } : undefined}>{now ? `${step} · now` : `${step} · customer's phone`}</Label>
        <H2>Connect the customer's phone</H2>
      </View>
      {live ? (
        <>
          <Body>SwapUp Check is open on the customer's phone.</Body>
          <Btn title={showQr ? "Hide the QR codes" : "Show the QR codes again"} kind="ghost" onPress={onToggleQr} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} />
        </>
      ) : phoneLed ? (
        <Body>
          Turn the tablet to the customer: the Wi‑Fi code if they need it, then the test code. From there their phone leads: it identifies itself, shows a code for
          you to scan, then tests itself.
        </Body>
      ) : focus ? (
        <Body>Turn the tablet to the customer: the Wi‑Fi code if they need it, then the test code. SwapUp Check downloads, opens and tests the phone by itself.</Body>
      ) : (
        <Body muted>After the photos (step 1) — or skip them. If the customer is ready now, they can scan already.</Body>
      )}
    </Card>
  );
}

/**
 * Step 3 "The phone tests itself" — today's live progress, in one place. In the
 * phone-led flow it is step 4, starts after the scan, and opens with the battery
 * health screenshot (`phase` says where the phone is).
 */
export function TestsStepCard({
  v,
  label = "Step 3 · customer's phone",
  phoneLed = false,
  phase = null,
}: {
  v: TestSessionView;
  label?: string;
  phoneLed?: boolean;
  phase?: PhonePhase | null;
}) {
  const done = v.progress?.done ?? Object.keys(v.results ?? {}).length;
  const total = v.progress?.total ?? v.plan?.length ?? 0;
  // Phone-led: the phone is "joined" while it identifies itself and waits for the scan — not testing yet.
  const beforeTests = phoneLed && (phase === "identify" || phase === "scan" || (phase === null && v.status === "joined"));
  const running = (v.status === "joined" || v.status === "testing") && !beforeTests;
  const finished = v.status === "complete" || v.status === "applied";
  const battery = batteryHealth(v.results);
  const bl = battery ? batteryLine(battery) : null;
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <View style={{ gap: 4, flexShrink: 1, minWidth: 0 }}>
          <Label>{label}</Label>
          <H2>The phone tests itself</H2>
        </View>
        {finished ? <Chip text="Tests done" tone="up" /> : running && total ? <Chip text={`${done} of ${total}`} tone="fix" /> : null}
      </View>
      {running || finished ? (
        <View style={{ height: 10, borderRadius: 5, backgroundColor: L.surface2, overflow: "hidden" }}>
          <View style={{ width: `${total ? Math.min(100, Math.round((done / total) * 100)) : 0}%`, height: "100%", backgroundColor: finished ? L.up : L.fix }} />
        </View>
      ) : null}
      <Body muted={!running}>
        {finished
          ? `The customer's phone has finished — ${done} of ${total} tests in. Each result is below.`
          : phoneLed && phase === "battery"
            ? "First the battery health: the customer screenshots the phone's battery page and chooses the screenshot. Then the tests start by themselves."
            : running
              ? `${done} of ${total} tests done. Each result appears below as it lands. The customer only swipes the screen and plugs in the charger when asked.`
              : v.status === "expired" || v.status === "cancelled"
                ? "The phone didn't finish testing."
                : phoneLed
                  ? "Starts by itself after the scan (step 3): first the battery health, then the tests — the customer only swipes the screen and plugs in the charger when asked."
                  : "Starts by itself once SwapUp Check opens on the customer's phone — no questions."}
      </Body>
      {bl ? <KV label="Battery health" value={bl.text} tone={bl.tone} /> : null}
    </Card>
  );
}

// ── the phone-led flow: Step 2 · Identify the phone ──────────────────────────

/**
 * The IMEI(s) already on the case (GET /api/cases/<id>), to set against what the
 * customer typed. Fetched only once something was typed, and again when it changes
 * or the session moves on (Apply fills an empty case IMEI). A failure just means
 * no comparison is shown — it never blocks the screen.
 */
function useCaseImeis(api: StaffClient, caseId: string, typed: string, status: string) {
  const [rec, setRec] = useState<{ imei: string | null; imei2: string | null } | null>(null);
  useEffect(() => {
    if (!typed) {
      setRec(null);
      return;
    }
    let alive = true;
    api
      .get<unknown>(`/api/cases/${encodeURIComponent(caseId)}`)
      .then((r) => {
        if (alive) setRec(readCaseImeis(r));
      })
      .catch(() => {
        /* no comparison — the IMEIs still show */
      });
    return () => {
      alive = false;
    };
  }, [api, caseId, typed, status]);
  return rec;
}

/** Trade-in model names by id (GET /api/catalog/models), fetched once per server and only when a pick needs a name. */
const catalogs = new Map<string, Promise<Record<string, string>>>();
function usePickedLabel(api: StaffClient, modelId: string | null, own: string | null): string | null {
  const [label, setLabel] = useState<string | null>(own);
  useEffect(() => {
    if (!modelId || own) {
      setLabel(own);
      return;
    }
    let alive = true;
    let names = catalogs.get(api.base);
    if (!names) {
      names = api.get<unknown>("/api/catalog/models").then(modelLabels);
      catalogs.set(api.base, names);
      names.catch(() => catalogs.delete(api.base)); // try again next time
    }
    names.then((m) => alive && setLabel(m[modelId] ?? null)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, modelId, own]);
  return label;
}

function ImeiRow({ label, value, check }: { label: string; value: string; check: "ok" | "bad" | null }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: L.border }}>
      <Text style={{ color: L.muted, fontSize: 16, minWidth: 64 }}>{label}</Text>
      <Text style={{ color: L.ink, fontSize: 19, fontWeight: "800", letterSpacing: 1, fontVariant: ["tabular-nums"], flexGrow: 1 }} selectable>
        {value}
      </Text>
      {check ? <Chip text={check === "ok" ? "✓ Check digit OK" : "✕ Check digit wrong"} tone={check === "ok" ? "up" : "bad"} /> : null}
    </View>
  );
}

const MOBILE = /^(\d{5})(\d{5})$/;

/**
 * Step 2 "Identify the phone": what the phone says it is, what the customer answered
 * on "Is this your phone?", and the IMEI(s) they typed from *#06# — set against the
 * case's. A picked model is the customer's CLAIM: shown, never a match.
 */
export function IdentifyStepCard({ v, api, phase, label = "Step 2 · customer's phone" }: { v: TestSessionView; api: StaffClient; phase: PhonePhase | null; label?: string }) {
  const id = readIdentity(v.declared);
  const typed = [id.imei, id.imei2].filter(Boolean).join("|");
  const recorded = useCaseImeis(api, v.caseId, typed, v.status);
  const pickedLabel = usePickedLabel(api, id.picked?.modelId ?? null, id.picked?.label ?? null);
  // The server's verdict when it gives one (it reads the case directly); our own comparison
  // for an older server. The case fetch still supplies the numbers to show.
  const agreement = readImeiAgreement(v);
  const local = imeiMismatch(id, recorded);
  const mismatch = agreement === "differs" ? (local ?? { recorded: [] }) : agreement === null ? local : null;
  const agrees = agreement === "match" || (agreement === null && !!recorded && !!typed && !local && !!(recorded.imei || recorded.imei2));
  const d = v.device;
  const sm = v.summary?.model;
  const answered = id.identityConfirmed !== null || !!id.picked;
  const asking = !answered && (phase === "identify" || (phase === null && v.status === "joined"));
  const says = customerSays(id, pickedLabel, asking);
  const match = sm ? (MATCH[sm.match] ?? MATCH.none) : null;
  const reported = d ? [cap(d.brand || d.manufacturer), d.modelName].filter(Boolean).join(" ") : "";

  const chip = mismatch ? (
    <Chip text="IMEI differs" tone="bad" />
  ) : id.picked ? (
    <Chip text="Customer picked" tone="warn" />
  ) : id.identityConfirmed === true ? (
    <Chip text="Confirmed by the customer" tone="up" />
  ) : id.identityConfirmed === false ? (
    <Chip text="Not confirmed" tone="warn" />
  ) : asking ? (
    <Chip text="Answering now" tone="fix" />
  ) : null;

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <View style={{ gap: 4, flexShrink: 1, minWidth: 0 }}>
          <Label>{label}</Label>
          <H2>Identify the phone</H2>
        </View>
        {chip}
      </View>
      {!d ? (
        <Body muted>When SwapUp Check opens, the customer's phone says what it is, the customer confirms it, and types its IMEI. It all appears here.</Body>
      ) : (
        <>
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Text style={{ fontSize: 22, fontWeight: "800", color: L.ink }}>
                {sm?.label ? `${sm.label}${sm.variant ? ` · ${sm.variant}` : ""}` : "Not identified"}
              </Text>
              {match ? <Chip text={match.label} tone={match.tone} /> : null}
            </View>
            {reported ? (
              <Body muted>
                The phone calls itself {reported}
                {d.modelCode && d.modelCode !== d.modelName ? ` (${d.modelCode})` : ""}
              </Body>
            ) : null}
          </View>
          <View>
            <KV label="Customer says" value={says.text} tone={says.tone} />
            {customerStarted(v) ? <KV label="Started by" value="The customer, from the counter QR" /> : null}
            {id.customerName || id.customerPhone ? (
              <KV
                label="Customer (typed on their phone)"
                value={[id.customerName, id.customerPhone ? id.customerPhone.replace(MOBILE, "$1 $2") : null].filter(Boolean).join(" · ")}
              />
            ) : null}
          </View>
          {id.picked ? (
            <Body muted>
              {sm?.match === "none" || !sm
                ? "The phone's own model code isn't in the catalogue, so if the case has no model yet, Apply uses this pick — labelled “customer picked”. Check it against Settings › About phone."
                : "A pick is only the customer's word. The phone's own model code wins — check Settings › About phone if they disagree."}
            </Body>
          ) : null}

          <View style={{ gap: 2 }}>
            <Label>IMEI (dialled *#06#)</Label>
            {id.imei ? <ImeiRow label="IMEI 1" value={id.imei} check={imeiCheck(id.imei)} /> : null}
            {id.imei2 ? <ImeiRow label="IMEI 2" value={id.imei2} check={imeiCheck(id.imei2)} /> : null}
            {!id.imei && !id.imei2 ? (
              <Body muted>{asking ? "Not typed yet." : "Not given — the customer skipped it. Dial *#06# on the phone, or read the box."}</Body>
            ) : null}
          </View>
          {mismatch ? (
            <Banner tone="bad" title="IMEI differs from the one recorded">
              {`${mismatch.recorded.length ? `The case has ${mismatch.recorded.join(" / ")}. ` : ""}The case keeps its IMEI — dial *#06# on the phone and check before you lock the trade-in.`}
            </Banner>
          ) : agrees && v.status !== "applied" ? (
            // Not after Apply: an empty case IMEI is filled from the phone then, so "matches" would prove nothing.
            <Text style={{ color: L.up, fontSize: 15, fontWeight: "700" }}>Matches the IMEI recorded on the case.</Text>
          ) : null}
        </>
      )}
    </Card>
  );
}

// ── live status ──────────────────────────────────────────────────────────────

/** The phone-led flow's stepper — the customer's phone shows the same rail (Identify · Scan · Test · Result). */
export function ScanFirstStepper({ v, phase, wide }: { v: TestSessionView; phase: PhonePhase | null; wide: boolean }) {
  const reached = scanFirstReached(v.status, phase, !!v.device || !!v.joinedAt);
  const done = v.progress?.done ?? 0;
  const total = v.progress?.total ?? v.plan?.length ?? 0;
  const labels = SCAN_FIRST_STEPS.map((l, i) =>
    i === 0 && v.status === "opened" ? "Page opened" : i === 3 && reached >= 3 && total ? `Test (${done} of ${total})` : l
  );
  return <StepRail labels={labels} reached={reached} stopped={v.status === "expired" || v.status === "cancelled"} wide={wide} />;
}

export function Stepper({ v, wide }: { v: TestSessionView; wide: boolean }) {
  const reached =
    v.status === "complete" || v.status === "applied"
      ? 4
      : v.status === "testing"
        ? 3
        : v.status === "joined"
          ? 2
          : v.status === "opened"
            ? 1
            : v.status === "waiting"
              ? 0
              : v.completedAt
                ? 4
                : Object.keys(v.results ?? {}).length
                  ? 3
                  : v.joinedAt
                    ? 2
                    : v.openedAt
                      ? 1
                      : 0;
  const stopped = v.status === "expired" || v.status === "cancelled";
  const done = v.progress?.done ?? 0;
  const total = v.progress?.total ?? v.plan?.length ?? 0;
  const labels = ["Waiting", "Page opened", "App connected", reached >= 3 && total ? `Testing (${done} of ${total})` : "Testing", "Done"];
  return <StepRail labels={labels} reached={reached} stopped={stopped} wide={wide} />;
}

/** Numbered circles joined by a line; `reached` = the current step, and the last step reached means all done. */
function StepRail({ labels, reached, stopped, wide }: { labels: string[]; reached: number; stopped: boolean; wide: boolean }) {
  const last = labels.length - 1;
  return (
    <View style={{ flexDirection: "row", gap: wide ? 8 : 4 }}>
      {labels.map((label, i) => {
        const isDone = i < reached || (i === last && reached === last);
        const current = i === reached && !isDone && !stopped;
        const color = stopped && i === reached ? L.warn : isDone ? L.up : current ? L.fix : L.border;
        return (
          <View key={i} style={{ flex: 1, alignItems: "center", gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "stretch" }}>
              <View style={{ flex: 1, height: 3, backgroundColor: i === 0 ? "transparent" : i <= reached ? L.up : L.border }} />
              <View
                style={{
                  width: wide ? 34 : 28,
                  height: wide ? 34 : 28,
                  borderRadius: 17,
                  backgroundColor: isDone ? L.up : L.surface,
                  borderWidth: 3,
                  borderColor: color,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: isDone ? "#fff" : color, fontWeight: "900", fontSize: wide ? 16 : 13 }}>{isDone ? "✓" : i + 1}</Text>
              </View>
              <View style={{ flex: 1, height: 3, backgroundColor: i === last ? "transparent" : i < reached ? L.up : L.border }} />
            </View>
            <Text
              style={{ fontSize: wide ? 15 : 12, fontWeight: current || isDone ? "800" : "600", color: current ? L.fix : isDone ? L.ink : L.muted, textAlign: "center" }}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function nowLine(v: TestSessionView): { text: string; tone: Tone } {
  const done = v.progress?.done ?? 0;
  const total = v.progress?.total ?? 0;
  switch (v.status) {
    case "waiting":
      return { text: "Waiting for the customer to scan the code.", tone: "muted" };
    case "opened":
      return { text: "The customer opened the download page. Next: install and open SwapUp Check.", tone: "fix" };
    case "joined":
      return { text: "SwapUp Check is connected on the customer's phone. Results appear here as each test finishes.", tone: "fix" };
    case "testing":
      return { text: `Testing — ${done} of ${total} done. Results appear below as each test finishes.`, tone: "fix" };
    case "complete":
      return { text: "The customer has finished. Check the summary, then apply it to the case.", tone: "up" };
    case "applied":
      return { text: `Applied to case ${v.caseRef}. Continue pricing on the case.`, tone: "up" };
    case "expired":
      return { text: v.joinedAt ? "This test session expired (2 hours after the app connected)." : "This code expired before the app connected.", tone: "warn" };
    case "cancelled":
      return { text: "This test was cancelled. The code no longer works.", tone: "muted" };
    default:
      return { text: String(v.status), tone: "muted" };
  }
}

// ── results ──────────────────────────────────────────────────────────────────

function cap(s: string | null | undefined) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

export function DeviceCard({ v }: { v: TestSessionView }) {
  const d = v.device;
  if (!d) {
    return (
      <Card>
        <H2>Phone</H2>
        <Body muted>The phone's details appear here when SwapUp Check connects.</Body>
      </Card>
    );
  }
  const reported = [cap(d.brand || d.manufacturer), d.modelName].filter(Boolean).join(" ");
  const title = v.summary?.model.label || reported || "Unknown phone";
  const reportedGb = d.totalDiskBytes ? fmtBytes(d.totalDiskBytes) : null;
  const variant = v.summary?.model.variant;
  // A run in the browser version of SwapUp Check says "web-<version>" (iPhones are always tested that way).
  const inBrowser = !!d.appVersion && d.appVersion.startsWith("web-");
  const os = /^apple$/i.test(d.brand || d.manufacturer || "") ? "iOS" : "Android";
  const storage = variant ? `${variant}${reportedGb ? ` (phone reports ${reportedGb})` : ""}` : reportedGb ? `${reportedGb} reported by the phone` : "Not reported";
  return (
    <Card>
      <Label>Phone</Label>
      <Text style={{ fontSize: 24, fontWeight: "800", color: L.ink }}>{title}</Text>
      {reported && reported !== title ? <Body muted>The phone calls itself {reported}{d.modelCode && d.modelCode !== d.modelName ? ` (${d.modelCode})` : ""}</Body> : null}
      {d.isPhysicalDevice === false ? <Banner tone="bad" title="Not a real phone">The app is running on an emulator. Don't use these results for a trade-in.</Banner> : null}
      <View>
        <KV label="Storage" value={storage} />
        <KV label={os} value={d.osVersion ? `${os} ${d.osVersion}` : "Not reported"} />
        <KV label="Battery charge" value={d.batteryLevelPct != null ? `${d.batteryLevelPct}%` : "Not reported"} />
        {d.totalMemoryBytes ? <KV label="Memory (RAM)" value={fmtBytes(d.totalMemoryBytes)} /> : null}
        {d.appVersion ? <KV label="SwapUp Check" value={inBrowser ? `In the browser, no app (v${d.appVersion.slice(4)})` : `v${d.appVersion}`} /> : null}
      </View>
    </Card>
  );
}

const OUTCOME: Record<Outcome | "pending" | "notrun", { icon: string; label: string; tone: Tone }> = {
  pass: { icon: "✓", label: "Passed", tone: "up" },
  fail: { icon: "✕", label: "Failed", tone: "bad" },
  skip: { icon: "–", label: "Skipped", tone: "muted" },
  unsupported: { icon: "–", label: "Not supported on this phone", tone: "muted" },
  pending: { icon: "·", label: "Not run yet", tone: "muted" },
  notrun: { icon: "–", label: "Not run", tone: "muted" },
};

function detailLine(d: Record<string, unknown> | null | undefined): string | null {
  if (!d || typeof d !== "object") return null;
  const parts: string[] = [];
  // Battery health (phone-led flow): the % GradeIQ read off the customer's screenshot, and how.
  // `method` only here — the automatic tests carry one too ("touch grid", "timeout") that was never shown.
  if (typeof d.healthPct === "number" && d.healthPct > 0) {
    parts.push(`${Math.round(d.healthPct)}% health${d.healthPct < BATTERY_HEALTH_MIN ? ` — below ${BATTERY_HEALTH_MIN}%` : ""}`);
    if (typeof d.method === "string" && d.method.trim()) parts.push(d.method.trim());
  }
  const side = d.side;
  if (typeof side === "string" && side) parts.push(side === "both" ? "Front and rear" : `${cap(side)} camera`);
  for (const k of ["reason", "note", "message"]) {
    const x = d[k];
    if (typeof x === "string" && x.trim()) parts.push(x.trim());
  }
  return parts.length ? parts.join(" · ") : null;
}

export function TestsCard({ v }: { v: TestSessionView }) {
  const plan = v.plan ?? [];
  const results = v.results ?? {};
  const extra = Object.keys(results).filter((id) => !plan.some((p) => p.id === id));
  const rows = [...plan, ...extra.map((id) => ({ id, name: id, critical: false }))];
  const finished = v.status === "complete" || v.status === "applied" || v.status === "expired" || v.status === "cancelled";
  const done = v.progress?.done ?? Object.keys(results).length;
  const total = v.progress?.total ?? plan.length;
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <H2>Tests</H2>
        {total ? <Text style={{ fontSize: 16, color: L.muted, fontWeight: "700" }}>{done} of {total} in</Text> : null}
      </View>
      {rows.length === 0 ? <Body muted>The list of tests appears when SwapUp Check connects.</Body> : null}
      {rows.map((t) => {
        const r = results[t.id];
        const key: keyof typeof OUTCOME = r ? (OUTCOME[r.outcome] ? r.outcome : "skip") : finished ? "notrun" : "pending";
        // A browser run's "unsupported" is the browser's limit, not the phone's.
        const o = key === "unsupported" && v.device?.appVersion?.startsWith("web-") ? { ...OUTCOME.unsupported, label: "Can't test in a browser" } : OUTCOME[key];
        const untestedKey = t.critical && key !== "pass" && key !== "fail" && (r || finished);
        const tone: Tone = untestedKey ? "warn" : o.tone;
        const color = toneColor(tone);
        const det = r ? detailLine(r.detail) : null;
        return (
          <View key={t.id} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: L.border }}>
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                backgroundColor: r ? (tone === "up" ? L.upBg : tone === "bad" ? L.badBg : tone === "warn" ? L.warnBg : L.surface2) : "transparent",
                borderWidth: r ? 0 : 1.5,
                borderColor: L.border,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 19, fontWeight: "900", color }}>{o.icon}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: r ? L.ink : L.muted }}>
                {t.name}
                {t.critical ? <Text style={{ color: L.muted, fontWeight: "600", fontSize: 14 }}>  · key test</Text> : null}
              </Text>
              {det ? <Text style={{ fontSize: 15, color: L.muted }}>{det}</Text> : null}
              {untestedKey ? <Text style={{ fontSize: 15, color: L.warn, fontWeight: "700" }}>Untested — not counted as passed</Text> : null}
            </View>
            <Text style={{ fontSize: 15, fontWeight: "800", color, textAlign: "right", maxWidth: 140 }}>{o.label}</Text>
          </View>
        );
      })}
    </Card>
  );
}

function yesNo(b: boolean | null | undefined): { text: string; tone?: Tone } {
  if (b === true) return { text: "Yes", tone: "bad" };
  if (b === false) return { text: "No" };
  return { text: "Not answered", tone: "muted" };
}

/** `withImei` false: the phone-led layout shows the IMEIs in "Identify the phone" instead. */
export function DeclaredCard({ v, withImei = true }: { v: TestSessionView; withImei?: boolean }) {
  const d = v.declared;
  return (
    <Card>
      <H2>What the customer says</H2>
      <Body muted>Things a phone can't test on itself. Check them with your own eyes too.</Body>
      {d ? (
        <View>
          {(
            [
              ["Screen cracked", d.screenCracked],
              ["Back glass cracked", d.backCracked],
              ["Liquid damage", d.liquid],
            ] as const
          ).map(([label, val]) => {
            const x = yesNo(val);
            return <KV key={label} label={label} value={x.text} tone={x.tone} />;
          })}
          {withImei ? <KV label="IMEI (from *#06#)" value={d.imei || "Not given"} tone={d.imei ? undefined : "muted"} /> : null}
          {withImei && d.imei2 ? <KV label="IMEI 2" value={d.imei2} /> : null}
        </View>
      ) : (
        <Body muted>Not answered yet.</Body>
      )}
    </Card>
  );
}

const VERDICT: Record<DiagnosticSummary["verdict"], { title: string; tone: Tone; body: string }> = {
  all_passed: { title: "No faults found", tone: "up", body: "Every key test ran and passed." },
  faults_found: { title: "Faults found", tone: "bad", body: "The faults below go on the case when you apply." },
  incomplete: { title: "Incomplete", tone: "warn", body: "A key test has no pass or fail. Untested is never counted as passed — check it by hand." },
};
const MATCH: Record<DiagnosticSummary["model"]["match"], { label: string; tone: Tone }> = {
  exact: { label: "Exact match", tone: "up" },
  family: { label: "Close match — check it", tone: "warn" },
  none: { label: "No catalogue match", tone: "bad" },
};

export function SummaryCard({ v }: { v: TestSessionView }) {
  const sm = v.summary;
  if (!sm) {
    return (
      <Card>
        <H2>Summary</H2>
        <Body muted>The summary appears as soon as results come in.</Body>
      </Card>
    );
  }
  // While the customer is still testing, a test that hasn't come up yet isn't "untested" — it's just not run yet.
  const inProgress = v.status === "waiting" || v.status === "opened" || v.status === "joined" || v.status === "testing";
  const results = v.results ?? {};
  const untested = inProgress ? sm.untested.filter((u) => !!results[u.id]) : sm.untested;
  const toRun = inProgress ? sm.untested.length - untested.length : 0;
  const verdict = inProgress
    ? {
        title: "Still testing",
        tone: "fix" as Tone,
        body: `${v.progress?.done ?? 0} of ${v.progress?.total ?? v.plan?.length ?? 0} tests in. The verdict is final when the customer finishes.`,
      }
    : sm.verdict === "faults_found" && sm.faults.length === 0
      ? // Only tests that map to no repair fault failed (motion, flash, sensors…): say so, not "the faults below".
        { title: "Some tests failed", tone: "warn" as Tone, body: "Nothing from them goes on the case by itself — see the notes below and check those parts by hand." }
      : (VERDICT[sm.verdict] ?? VERDICT.incomplete);
  const match = MATCH[sm.model.match] ?? MATCH.none;
  const bh = batteryHealth(results);
  const battery = bh ? batteryLine(bh) : null;
  const criticalUntested = untested.filter((u) => u.critical);
  const otherUntested = untested.filter((u) => !u.critical);
  return (
    <Card>
      <H2>Summary</H2>
      <Banner tone={verdict.tone} title={verdict.title}>
        {verdict.body}
      </Banner>

      <View style={{ gap: 6 }}>
        <Label>Model</Label>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Text style={{ fontSize: 19, fontWeight: "800", color: L.ink }}>
            {sm.model.label ? `${sm.model.label}${sm.model.variant ? ` · ${sm.model.variant}` : ""}` : "Not identified"}
          </Text>
          <Chip text={match.label} tone={match.tone} />
        </View>
        {sm.model.why ? <Body muted>{sm.model.why}</Body> : null}
      </View>

      {battery ? (
        <View style={{ gap: 6 }}>
          <Label>Battery health</Label>
          <Text style={{ fontSize: 19, fontWeight: "800", color: battery.tone === "muted" ? L.muted : toneColor(battery.tone) }}>{battery.text}</Text>
        </View>
      ) : null}

      <View style={{ gap: 6 }}>
        <Label>{inProgress ? "Faults found so far" : "Faults found"}</Label>
        {sm.faults.length === 0 ? (
          <Body muted>{inProgress ? "None so far." : "None."}</Body>
        ) : (
          sm.faults.map((f, i) => (
            <View key={`${f.id}-${i}`} style={{ gap: 2 }}>
              <Text style={{ fontSize: 17, fontWeight: "800", color: L.bad }}>✕ {faultLabel(f.id)}</Text>
              {f.because ? <Body muted>{f.because.replace(/^because\s+/i, "").replace(/^\w/, (c) => c.toUpperCase())}</Body> : null}
            </View>
          ))
        )}
      </View>

      {untested.length || toRun ? (
        <View style={{ gap: 6 }}>
          <Label>Not tested</Label>
          {toRun ? <Body muted>{toRun === 1 ? "1 test still to run." : `${toRun} tests still to run.`}</Body> : null}
          {criticalUntested.map((u) => (
            <Text key={u.id} style={{ fontSize: 17, fontWeight: "700", color: L.warn }}>
              ⚠ {u.name} — key test, check it by hand
            </Text>
          ))}
          {otherUntested.length ? <Body muted>{otherUntested.map((u) => u.name).join(", ")}</Body> : null}
        </View>
      ) : null}

      {sm.notes.length ? (
        <View style={{ gap: 4 }}>
          <Label>Notes</Label>
          {sm.notes.map((n, i) => (
            <Body key={i}>• {n}</Body>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
