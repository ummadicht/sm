// Who is signed in, to which store, on which server — and the way out.
// A store manager can also set the store Wi‑Fi here, before a customer is waiting,
// and make this device the store tablet (or manage the store's tablets).
// Everyone can set the PIN that unlocks the store tablet, and see the store's
// counter QR (a manager prints it and can replace it).
import { InviteStaff } from "./InviteStaff";
import { CounterQrCard } from "./CounterQr";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { APP_VERSION, DEFAULT_SERVER, IS_WEB } from "../../shared/config";
import { StaffClient, errText } from "../staffClient";
import { TEST_PROGRAMME, programmeBanner } from "../programme";
import type { StaffUser, StoreDeviceCreated, WifiResponse } from "../types";
import { Banner, Body, Btn, Card, Chip, Columns, H2, KV, Label, TopBar, useLayout, L } from "../ui";
import { WifiForm, WifiInfo } from "./SessionParts";
import { ChangePin, StoreTabletCard } from "./TabletSettings";

const SECURITY_LABEL: Record<string, string> = { WPA: "WPA / WPA2 / WPA3", WEP: "WEP", nopass: "None (open)" };

function clock(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? `today ${time}` : `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} ${time}`;
}

export function Settings({
  api,
  user,
  expiresAt,
  tablet,
  onBack,
  onSignOut,
  onUseAsTablet,
  onStopTablet,
}: {
  api: StaffClient;
  user: StaffUser;
  expiresAt: string | null;
  /** Set when this device is the store tablet (the staff sign-in is then in memory only). */
  tablet: { id: string | null; name: string | null } | null;
  onBack: () => void;
  /** Personal device: sign out. Store tablet: back to "Who's serving?" (the tablet stays signed in for the store). */
  onSignOut: () => void;
  onUseAsTablet: (res: StoreDeviceCreated) => Promise<void>;
  onStopTablet: () => void;
}) {
  const { wide, pad, content } = useLayout();
  const store = user.store!;
  const canEditWifi = user.role === "store_manager";

  const [wifi, setWifi] = useState<WifiInfo | null | undefined>(undefined);
  const [wifiErr, setWifiErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadWifi = useCallback(async () => {
    setWifiErr(null);
    try {
      const r = await api.get<WifiResponse>(`/api/stores/${encodeURIComponent(store.id)}/wifi`);
      setWifi(r?.wifi && r.qr ? { ...r.wifi, qr: r.qr } : null);
    } catch (e) {
      setWifiErr(errText(e));
    }
  }, [api, store.id]);
  useEffect(() => {
    loadWifi();
  }, [loadWifi]);

  function confirmSignOut() {
    Alert.alert("Sign out?", "Open tests keep running.", [
      { text: "Stay", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: onSignOut },
    ]);
  }

  const until = clock(expiresAt);

  const account = (
    <Card>
      <Label>Signed in</Label>
      <H2 style={{ fontSize: 24, lineHeight: 30 }}>{user.name}</H2>
      <View>
        {user.username ? <KV label="Username" value={user.username} /> : null}
        <KV label="Role" value={user.roleLabel || user.role} />
        {user.org ? <KV label="Programme" value={user.org.name} /> : null}
        {until && !tablet ? <KV label="Sign-in lasts until" value={until} /> : null}
      </View>
      {programmeBanner(user.org) ? <Chip text={TEST_PROGRAMME} tone="warn" /> : null}
      {tablet ? (
        <>
          <Body muted>Locks after 15 idle minutes.</Body>
          <Btn title="Switch person" kind="secondary" onPress={onSignOut} />
        </>
      ) : (
        <>
          <Body muted>Sign-ins last 12 hours.</Body>
          <Btn title="Sign out" kind="danger" onPress={confirmSignOut} />
        </>
      )}
    </Card>
  );

  const storeCard = (
    <Card>
      <Label>Store</Label>
      <H2 style={{ fontSize: 24, lineHeight: 30 }}>{store.name}</H2>
      <View>
        <KV label="Store code" value={store.code || "—"} />
        <KV label="City" value={store.city || "—"} />
      </View>

    </Card>
  );

  const wifiCard = (
    <Card>
      <H2>Customer Wi‑Fi</H2>
      {saved ? <Banner tone="up" title="Saved — new QR codes use it." /> : null}
      {editing || (wifi === null && canEditWifi) ? (
        <WifiForm
          api={api}
          storeId={store.id}
          current={wifi ?? null}
          onCancel={wifi ? () => setEditing(false) : undefined}
          onSaved={(w) => {
            setWifi(w);
            setEditing(false);
            setSaved(true);
          }}
        />
      ) : wifi === undefined ? (
        wifiErr ? (
          <Banner tone="bad" title="Couldn't load the store Wi‑Fi" action={{ title: "Try again", onPress: loadWifi }}>
            {wifiErr}
          </Banner>
        ) : (
          <Body muted>Loading…</Body>
        )
      ) : wifi === null ? (
        <Banner tone="muted" title="No store Wi‑Fi saved">
          A manager can add it.
        </Banner>
      ) : (
        <View>
          <KV label="Network name" value={wifi.ssid} />
          {wifi.security ? <KV label="Security" value={SECURITY_LABEL[wifi.security] ?? wifi.security} /> : null}
          {wifi.hidden ? <KV label="Hidden network" value="Yes" /> : null}
          {canEditWifi ? (
            <Btn
              title="Change Wi‑Fi"
              kind="secondary"
              onPress={() => {
                setSaved(false);
                setEditing(true);
              }}
              style={{ marginTop: 10, alignSelf: "flex-start" }}
            />
          ) : (
            <Body muted style={{ marginTop: 8 }}>
              Managers only.
            </Body>
          )}
        </View>
      )}
    </Card>
  );

  const serverCard = (
    <Card>
      <H2>Server</H2>
      <Text style={{ fontSize: 17, fontWeight: "700", color: L.ink }} selectable>
        {api.base}
      </Text>
      {IS_WEB ? (
        <Body muted>Uses the server it was opened from.</Body>
      ) : tablet ? (
        // No "sign out" on the store tablet: it belongs to this server until a manager stops using it as the tablet.
        <Body muted>The store tablet stays on this server.</Body>
      ) : api.base !== DEFAULT_SERVER ? (
        <Banner tone="warn" title="Not the normal server">
          {`Normal: ${DEFAULT_SERVER} — sign out, then Advanced.`}
        </Banner>
      ) : (
        <Body muted>To change it: sign out, then Advanced.</Body>
      )}
      <KV label="App" value={IS_WEB ? `SwapUp Store in the browser v${APP_VERSION}` : `SwapUp Store v${APP_VERSION}`} />
    </Card>
  );

  return (
    <View style={{ flex: 1 }}>
      <TopBar title="Settings" subtitle={store.name} left={{ label: "‹ Home", onPress: onBack }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: pad, gap: 16, alignSelf: "center", width: content + pad * 2 }} keyboardShouldPersistTaps="handled">
          <Columns wide={wide}>
            <View style={{ gap: 16 }}>
              {canEditWifi ? <InviteStaff api={api} storeId={store.id} storeName={store.name} /> : null}
              {account}
              <ChangePin api={api} />
              {serverCard}
            </View>
            <View style={{ gap: 16 }}>
              {storeCard}
              {user.role === "store_manager" || user.role === "advisor" ? (
                <CounterQrCard api={api} storeName={store.name} canManage={user.role === "store_manager"} />
              ) : null}
              {user.role === "store_manager" ? (
                <StoreTabletCard api={api} storeName={store.name} thisDevice={tablet} onUseAsTablet={onUseAsTablet} onStopThisDevice={onStopTablet} />
              ) : null}
              {wifiCard}
            </View>
          </Columns>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
