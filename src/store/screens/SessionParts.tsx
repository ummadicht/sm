// The pieces of the Session screen's step 2 and the landing screens: the two customer-facing QR
// cards (Wi‑Fi / mobile hotspot, and the test code + browser web link) under "Connect the
// customer's phone" (ConnectHead). The camera step is ./CameraParts; the results themselves
// are on the answer and the grade report, not repeated here (owner, 2026-10-17: "Reduce the flow").
import React, { useCallback, useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import * as Device from "expo-device";
import * as NetInfo from "expo-network";
import { DEFAULT_SERVER, IS_WEB } from "../../shared/config";
import { QR } from "../QR";
import {
  DEFAULT_HOTSPOT,
  HOTSPOT_HINT,
  HOTSPOT_OFF_TEXT,
  WEB_CHECK_HINT,
  checkWebUrl,
  currentDeviceHotspot,
  wifiQr,
} from "../hotspot";
import { StaffClient, errText } from "../staffClient";
import { SavedHotspot, loadHotspot, saveHotspot } from "../storage";
import type { SessionStatus, WifiResponse, WifiSecurity } from "../types";
import { Banner, Body, Btn, Card, Chip, Columns, Details, Field, H2, Label, Segmented, Toggle, until, L } from "../ui";

export type WifiInfo = { ssid: string; qr: string; password?: string; security?: WifiSecurity; hidden?: boolean };

function copyText(text: string, onCopied: () => void) {
  if (IS_WEB && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).then(onCopied).catch(() => {});
  }
}

function openBrowserCheck(url: string) {
  if (IS_WEB && typeof window !== "undefined") {
    try {
      const u = new URL(url, window.location.origin);
      if (u.pathname.startsWith("/app/check")) {
        window.location.assign(`${window.location.origin}${u.pathname}${u.search}`);
        return;
      }
    } catch {
      // fall through
    }
    window.location.assign(url);
    return;
  }
  void Linking.openURL(url).catch(() => {});
}

async function detectCurrentDeviceHotspot(): Promise<WifiInfo> {
  const ip = IS_WEB ? null : await NetInfo.getIpAddressAsync().catch(() => null);
  const label = [Device.brand, Device.modelName].filter(Boolean).join("-") || Device.modelName || null;
  const cfg = currentDeviceHotspot(label, ip);
  return { ...cfg, qr: wifiQr(cfg) };
}

// ── ① Join our Wi‑Fi / Device Hotspot ─────────────────────────────────────────

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
  const [localHotspot, setLocalHotspot] = useState<WifiInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    void loadHotspot().then((h) => {
      if (!mounted || !h) return;
      setLocalHotspot({
        ssid: h.ssid,
        password: h.password,
        security: h.security,
        hidden: h.hidden,
        qr: wifiQr(h),
      });
    });
    return () => {
      mounted = false;
    };
  }, []);

  const activeWifi = wifi ?? localHotspot;

  const generateCurrentHotspot = useCallback(async () => {
    setBusy(true);
    try {
      const info = await detectCurrentDeviceHotspot();
      await saveHotspot({
        ssid: info.ssid,
        password: info.password ?? DEFAULT_HOTSPOT.password,
        security: info.security ?? "WPA",
        hidden: !!info.hidden,
      });
      setLocalHotspot(info);
      if (canEdit && storeId) {
        try {
          const r = await api.post<WifiResponse>(`/api/stores/${encodeURIComponent(storeId)}/wifi`, {
            ssid: info.ssid,
            password: info.password ?? "",
            security: info.security ?? "WPA",
            hidden: !!info.hidden,
          });
          if (r?.wifi && r.qr) {
            onSaved({ ...r.wifi, qr: r.qr });
            return;
          }
        } catch {
          // keep local hotspot QR
        }
      }
      onSaved(info);
    } finally {
      setBusy(false);
    }
  }, [api, canEdit, onSaved, storeId]);

  const switchOffHotspot = useCallback(async () => {
    setBusy(true);
    try {
      await saveHotspot(null);
      setLocalHotspot(null);
      if (canEdit && storeId && wifi) {
        try {
          await api.post<WifiResponse>(`/api/stores/${encodeURIComponent(storeId)}/wifi`, { ssid: "" });
        } catch {
          // ignore
        }
      }
      onSaved(null);
    } finally {
      setBusy(false);
    }
  }, [api, canEdit, onSaved, storeId, wifi]);

  return (
    <Card style={{ alignItems: "center", gap: 10 }}>
      <View style={{ alignSelf: "stretch", gap: 4 }}>
        <Label>{label}</Label>
        <H2>Device hotspot</H2>
      </View>

      {wifi === undefined && !localHotspot && wifiErr ? (
        <View style={{ alignSelf: "stretch" }}>
          <Banner tone="bad" title="Couldn't load the store Wi‑Fi" action={{ title: "Try again", onPress: onRetry }}>
            {wifiErr}
          </Banner>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", alignSelf: "stretch" }}>
        <Btn
          title="Generate hotspot QR"
          onPress={() => void generateCurrentHotspot()}
          busy={busy}
          style={{ flexGrow: 1 }}
        />
        <Btn
          title="Switch off hotspot"
          kind="secondary"
          onPress={() => void switchOffHotspot()}
          disabled={busy || !activeWifi}
          style={{ flexGrow: 1 }}
        />
      </View>

      {activeWifi ? (
        <>
          <Body style={{ textAlign: "center" }}>{HOTSPOT_HINT}</Body>
          <QR value={activeWifi.qr} size={qrSize} />
          <Text style={{ fontSize: 24, fontWeight: "800", color: L.ink, textAlign: "center" }} selectable>
            {activeWifi.ssid}
          </Text>
          {activeWifi.password && activeWifi.security !== "nopass" ? (
            <Body muted style={{ textAlign: "center" }}>
              Password: <Text style={{ color: L.ink, fontWeight: "800" }} selectable>{activeWifi.password}</Text>
            </Body>
          ) : null}
          <Body style={{ textAlign: "center", fontWeight: "700" }}>On mobile data? Skip this.</Body>
        </>
      ) : (
        <View style={{ alignSelf: "stretch", gap: 6 }}>
          <Body muted>{HOTSPOT_OFF_TEXT}</Body>
          <Body muted>{`Mobile data works — go to ${next}.`}</Body>
        </View>
      )}
    </Card>
  );
}

export function WifiForm({
  api,
  storeId,
  canSaveStore = true,
  current,
  onSaved,
  onCancel,
}: {
  api?: StaffClient;
  storeId?: string;
  canSaveStore?: boolean;
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
      if (!ssid.trim()) return setError("Enter the hotspot or Wi‑Fi name.");
      if (security !== "nopass" && !password) return setError("Enter the password, or choose “None”.");
      if (security === "WPA" && password.length < 8) return setError("A WPA password has 8+ characters.");
    }
    setBusy(true);
    try {
      const localCfg: SavedHotspot | null = clear
        ? null
        : { ssid: ssid.trim(), password: security === "nopass" ? "" : password, security, hidden };
      await saveHotspot(localCfg);
      const localInfo: WifiInfo | null = localCfg ? { ...localCfg, qr: wifiQr(localCfg) } : null;

      if (api && storeId && canSaveStore) {
        try {
          const body = clear ? { ssid: "" } : { ssid: ssid.trim(), password: security === "nopass" ? "" : password, security, hidden };
          const r = await api.post<WifiResponse>(`/api/stores/${encodeURIComponent(storeId)}/wifi`, body);
          onSaved(r?.wifi && r.qr ? { ...r.wifi, qr: r.qr } : localInfo);
          return;
        } catch {
          onSaved(localInfo);
          return;
        }
      }
      onSaved(localInfo);
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
  const [qrMode, setQrMode] = useState<"join" | "web">("join");
  const [copied, setCopied] = useState(false);
  const steps = ["Scan this code with your camera.", "Tap the link.", "Install SwapUp Check — or test in the browser.", "Type the code if asked."];
  const left = until(expiresAt);

  const serverBase = joinUrl.replace(/\/j\/[^/?#]+.*$/i, "") || DEFAULT_SERVER;
  const webUrl = checkWebUrl(serverBase, code);
  const activeQrUrl = qrMode === "web" ? webUrl : joinUrl;

  return (
    <Card style={{ alignItems: "center" }}>
      <View style={{ alignSelf: "stretch", gap: 4 }}>
        <Label>{label}</Label>
        <H2>Test your phone</H2>
      </View>
      <QR value={activeQrUrl} size={qrSize} />
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
        {activeQrUrl}
      </Text>

      <View
        style={{
          alignSelf: "stretch",
          backgroundColor: L.surface2,
          borderRadius: 12,
          padding: 12,
          gap: 8,
          borderWidth: 1,
          borderColor: L.border,
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: "800", color: L.ink }}>Don't want to download the Check app?</Text>
        <Body muted style={{ fontSize: 14, lineHeight: 20 }}>
          {WEB_CHECK_HINT}
        </Body>
        <Text style={{ color: L.fix, fontSize: 15, fontWeight: "700" }} selectable>
          {webUrl}
        </Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Btn title="Open web check" kind="secondary" onPress={() => openBrowserCheck(webUrl)} />
          <Btn
            title={qrMode === "web" ? "Show app QR" : "Show web QR"}
            kind="ghost"
            onPress={() => setQrMode((m) => (m === "web" ? "join" : "web"))}
          />
          {IS_WEB ? (
            <Btn
              title={copied ? "Copied" : "Copy link"}
              kind="ghost"
              onPress={() =>
                copyText(webUrl, () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
              }
            />
          ) : null}
        </View>
      </View>

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

// ── Landing Screen Cards: Current Device Hotspot (2 Buttons) + Browser Check Web Link ──

export function LandingHotspotAndWebCards({
  api,
  storeId,
  canEditWifi = false,
  serverBase,
  sessionCode,
  wide,
}: {
  api?: StaffClient;
  storeId?: string;
  canEditWifi?: boolean;
  serverBase?: string;
  sessionCode?: string | null;
  wide: boolean;
}) {
  const base = (api?.base || serverBase || DEFAULT_SERVER).replace(/\/+$/, "");
  const [wifi, setWifi] = useState<WifiInfo | null>(null);
  const [busyHotspot, setBusyHotspot] = useState(false);
  const [counterCode, setCounterCode] = useState<string | null>(null);
  const [copiedWeb, setCopiedWeb] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const saved = await loadHotspot();
      if (alive && saved) {
        setWifi({ ...saved, qr: wifiQr(saved) });
      }
      if (api && storeId) {
        try {
          const r = await api.get<WifiResponse>(`/api/stores/${encodeURIComponent(storeId)}/wifi`);
          if (alive && r?.wifi && r.qr) {
            setWifi({ ...r.wifi, qr: r.qr });
          }
        } catch {
          // Keep local hotspot state
        }
        try {
          const c = await api.get<{ code?: string; counterCode?: { code?: string } }>("/api/stores/counter-code");
          const code = typeof c?.code === "string" ? c.code : typeof c?.counterCode?.code === "string" ? c.counterCode.code : null;
          if (alive && code) setCounterCode(code);
        } catch {
          // Optional counter code
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, storeId]);

  const handleGenerateHotspotQr = useCallback(async () => {
    setBusyHotspot(true);
    try {
      const info = await detectCurrentDeviceHotspot();
      await saveHotspot({
        ssid: info.ssid,
        password: info.password ?? DEFAULT_HOTSPOT.password,
        security: info.security ?? "WPA",
        hidden: !!info.hidden,
      });
      setWifi(info);
      if (api && storeId && canEditWifi) {
        try {
          const r = await api.post<WifiResponse>(`/api/stores/${encodeURIComponent(storeId)}/wifi`, {
            ssid: info.ssid,
            password: info.password ?? "",
            security: info.security ?? "WPA",
            hidden: !!info.hidden,
          });
          if (r?.wifi && r.qr) {
            setWifi({ ...r.wifi, qr: r.qr });
          }
        } catch {
          // Keep local device hotspot QR
        }
      }
    } finally {
      setBusyHotspot(false);
    }
  }, [api, canEditWifi, storeId]);

  const handleSwitchOffHotspot = useCallback(async () => {
    setBusyHotspot(true);
    try {
      await saveHotspot(null);
      setWifi(null);
      if (api && storeId && canEditWifi) {
        try {
          await api.post<WifiResponse>(`/api/stores/${encodeURIComponent(storeId)}/wifi`, { ssid: "" });
        } catch {
          // ignore
        }
      }
    } finally {
      setBusyHotspot(false);
    }
  }, [api, canEditWifi, storeId]);

  const activeCode = sessionCode || counterCode || null;
  const webUrl = checkWebUrl(base, activeCode);
  const localWebUrl =
    IS_WEB && typeof window !== "undefined" ? checkWebUrl(window.location.origin, activeCode) : webUrl;

  const hotspotCard = (
    <Card style={{ alignItems: "center", gap: 12 }}>
      <View style={{ alignSelf: "stretch", gap: 4 }}>
        <Label>Device hotspot</Label>
        <H2>Current device hotspot</H2>
      </View>

      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", alignSelf: "stretch" }}>
        <Btn
          title="Generate hotspot QR"
          onPress={() => void handleGenerateHotspotQr()}
          busy={busyHotspot}
          style={{ flexGrow: 1 }}
        />
        <Btn
          title="Switch off hotspot"
          kind="secondary"
          onPress={() => void handleSwitchOffHotspot()}
          disabled={busyHotspot || !wifi}
          style={{ flexGrow: 1 }}
        />
      </View>

      {wifi ? (
        <>
          <Body muted style={{ alignSelf: "stretch" }}>
            {HOTSPOT_HINT}
          </Body>
          <QR value={wifi.qr} size={180} />
          <Text style={{ fontSize: 22, fontWeight: "800", color: L.ink, textAlign: "center" }} selectable>
            {wifi.ssid}
          </Text>
          {wifi.password && wifi.security !== "nopass" ? (
            <Body muted style={{ textAlign: "center" }}>
              Password: <Text style={{ color: L.ink, fontWeight: "800" }} selectable>{wifi.password}</Text>
            </Body>
          ) : (
            <Body muted style={{ textAlign: "center" }}>Open network (no password)</Body>
          )}
        </>
      ) : (
        <Body muted style={{ alignSelf: "stretch" }}>
          {HOTSPOT_OFF_TEXT}
        </Body>
      )}
    </Card>
  );

  const webLinkCard = (
    <Card style={{ alignItems: "center", gap: 10 }}>
      <View style={{ alignSelf: "stretch", gap: 4 }}>
        <Label>Browser check · no download</Label>
        <H2>Test without the app</H2>
      </View>
      <Body muted style={{ alignSelf: "stretch" }}>
        {WEB_CHECK_HINT}
      </Body>
      <QR value={webUrl} size={180} />
      {activeCode ? (
        <Text
          style={{ fontSize: 26, fontWeight: "900", letterSpacing: 5, color: L.ink, fontVariant: ["tabular-nums"], textAlign: "center" }}
          selectable
        >
          {activeCode}
        </Text>
      ) : null}
      <View
        style={{
          alignSelf: "stretch",
          backgroundColor: L.surface2,
          borderRadius: 10,
          padding: 10,
          borderWidth: 1,
          borderColor: L.border,
          gap: 4,
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: "700", color: L.muted, textTransform: "uppercase", letterSpacing: 0.6 }}>
          Web link (no app download)
        </Text>
        <Text style={{ color: L.fix, fontSize: 15, fontWeight: "700" }} selectable>
          {webUrl}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <Btn title="Open web check" onPress={() => openBrowserCheck(localWebUrl)} />
        {IS_WEB ? (
          <Btn
            title={copiedWeb ? "Copied" : "Copy web link"}
            kind="secondary"
            onPress={() =>
              copyText(webUrl, () => {
                setCopiedWeb(true);
                setTimeout(() => setCopiedWeb(false), 2000);
              })
            }
          />
        ) : null}
      </View>
    </Card>
  );

  return (
    <Columns wide={wide}>
      {hotspotCard}
      {webLinkCard}
    </Columns>
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
