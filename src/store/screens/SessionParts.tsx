// The pieces of the Session screen's step 2: the two customer-facing QR cards (Wi‑Fi, the test
// code) under "Connect the customer's phone" (ConnectHead). The camera step is ./CameraParts;
// the results themselves are on the answer and the grade report, not repeated here (owner,
// 2026-10-17: "Reduce the flow").
import React, { useState } from "react";
import { Text, View } from "react-native";
import { QR } from "../QR";
import { StaffClient, errText } from "../staffClient";
import type { SessionStatus, WifiResponse, WifiSecurity } from "../types";
import { Banner, Body, Btn, Card, Chip, Details, Field, H2, Label, Segmented, Toggle, until, L } from "../ui";

export type WifiInfo = { ssid: string; qr: string; password?: string; security?: WifiSecurity; hidden?: boolean };

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
            A manager can add it.
          </Banner>
          <Body muted>{`Mobile data works — go to ${next}.`}</Body>
        </View>
      ) : (
        <>
          <Body style={{ textAlign: "center" }}>Scan with your camera, tap Join.</Body>
          <QR value={wifi.qr} size={qrSize} />
          <Text style={{ fontSize: 24, fontWeight: "800", color: L.ink, textAlign: "center" }} selectable>
            {wifi.ssid}
          </Text>
          {wifi.password && wifi.security !== "nopass" ? (
            <Body muted style={{ textAlign: "center" }}>
              Can't scan? Password: <Text style={{ color: L.ink, fontWeight: "800" }} selectable>{wifi.password}</Text>
            </Body>
          ) : null}
          {wifi.hidden ? <Body muted style={{ textAlign: "center" }}>Hidden network.</Body> : null}
          <Body style={{ textAlign: "center", fontWeight: "700" }}>On mobile data? Skip this.</Body>
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
      if (!ssid.trim()) return setError("Enter the Wi‑Fi name.");
      if (security !== "nopass" && !password) return setError("Enter the password, or choose “None”.");
      if (security === "WPA" && password.length < 8) return setError("A WPA password has 8+ characters.");
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
      <Body muted>Use the guest network, not the till's.</Body>
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
      <Toggle label="Hidden network" value={hidden} onValueChange={setHidden} />
      {error ? <Banner tone="bad" title="Not saved">{error}</Banner> : null}
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <Btn title="Save Wi‑Fi" onPress={() => save(false)} busy={busy} style={{ flexGrow: 1 }} />
        {onCancel ? <Btn title="Cancel" kind="secondary" onPress={onCancel} disabled={busy} /> : null}
      </View>
      {current ? <Btn title="Remove Wi‑Fi" kind="ghost" onPress={() => save(true)} disabled={busy} style={{ alignSelf: "flex-start" }} /> : null}
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
  const steps = ["Scan this code with your camera.", "Tap the link.", "Install SwapUp Check — or test in the browser.", "Type the code if asked."];
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
        <Details title="Install blocked?">
          <Body muted>Settings → Install unknown apps → your browser → Allow. iPhone: test in the browser.</Body>
        </Details>
      </View>
      {status === "waiting" || status === "opened" ? (
        <Text style={{ color: L.muted, fontSize: 14, alignSelf: "stretch" }}>
          {left === "now" ? "Expires now." : `Expires in ${left}.`}
        </Text>
      ) : null}
    </Card>
  );
}

// ── Step 2 · Connect the customer's phone ─────────────────────────────────────

/**
 * Step 2 "Connect the customer's phone" — above the two QR cards (Wi‑Fi, then the test code).
 * Outlined while it is the advisor's step; once the phone is in, the codes fold away.
 */
export function ConnectHead({
  focus,
  live,
  showQr,
  onToggleQr,
  step = "Step 2",
}: {
  focus: boolean;
  live: boolean;
  showQr: boolean;
  onToggleQr: () => void;
  step?: string;
}) {
  const now = focus && !live;
  return (
    <Card style={now ? { borderColor: L.fix, borderWidth: 2 } : undefined}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <View style={{ gap: 4, flexShrink: 1, minWidth: 0 }}>
          <Label style={now ? { color: L.fix } : undefined}>{now ? `${step} · now` : `${step} · customer`}</Label>
          <H2>Connect the phone</H2>
        </View>
        {live ? <Chip text="Connected" tone="up" /> : null}
      </View>
      {live ? (
        <Btn title={showQr ? "Hide codes" : "Show codes"} kind="ghost" onPress={onToggleQr} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} />
      ) : (
        <Body>Turn the tablet to the customer.</Body>
      )}
    </Card>
  );
}
