// The pieces of the Session screen: the two customer-facing QR cards, the
// live stepper, and the result cards (device, tests, declarations, summary).
import React, { useState } from "react";
import { Text, View } from "react-native";
import { L } from "../../shared/theme";
import { fmtBytes } from "../../shared/ui";
import { QR } from "../QR";
import { StaffClient, errText } from "../staffClient";
import type { DiagnosticSummary, Outcome, SessionStatus, TestSessionView, WifiResponse, WifiSecurity } from "../types";
import { Banner, Body, Btn, Card, Chip, Field, H2, KV, Label, Segmented, Toggle, Tone, toneColor, until } from "../ui";

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
}: {
  api: StaffClient;
  storeId: string;
  wifi: WifiInfo | null | undefined;
  wifiErr: string | null;
  canEdit: boolean;
  qrSize: number;
  onSaved: (w: WifiInfo | null) => void;
  onRetry: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const head = (
    <View style={{ gap: 4 }}>
      <Label>Step 1 · optional</Label>
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
          <Body muted>The customer can use mobile data instead — go straight to step 2.</Body>
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

export function TestQrCard({ joinUrl, code, expiresAt, status, qrSize }: { joinUrl: string; code: string; expiresAt: string; status: SessionStatus; qrSize: number }) {
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
        <Label>Step 2</Label>
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

// ── live status ──────────────────────────────────────────────────────────────

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
  return (
    <View style={{ flexDirection: "row", gap: wide ? 8 : 4 }}>
      {labels.map((label, i) => {
        const isDone = i < reached || (i === 4 && reached === 4);
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
              <View style={{ flex: 1, height: 3, backgroundColor: i === 4 ? "transparent" : i < reached ? L.up : L.border }} />
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

export function DeclaredCard({ v }: { v: TestSessionView }) {
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
          <KV label="IMEI (from *#06#)" value={d.imei || "Not given"} tone={d.imei ? undefined : "muted"} />
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
    : (VERDICT[sm.verdict] ?? VERDICT.incomplete);
  const match = MATCH[sm.model.match] ?? MATCH.none;
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
