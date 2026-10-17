// Settings cards for the store tablet (docs/STORE-TABLET.md):
//  • StoreTabletCard — a manager makes this device the store tablet, sees the
//    store's tablets, removes a lost or replaced one, or stops using this one.
//  • ChangePin — anyone sets the 4-digit PIN they unlock the tablet with.
import React, { useCallback, useEffect, useState } from "react";
import { canKeepDevice } from "../storage";
import { Alert, Text, View } from "react-native";
import { L } from "../../shared/theme";
import { deviceNameProblem, newPinProblem, pinInput, PIN_LENGTH } from "../pin";
import { errText, type StaffClient } from "../staffClient";
import type { StoreDevice, StoreDeviceCreated } from "../types";
import { ago, Banner, Body, Btn, Card, Chip, Field, H2 } from "../ui";

function day(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
}

/**
 * thisDevice: null on a personal phone (offer to make it the tablet), or this
 * tablet's id when the app is in tablet mode (mark it, and offer to stop).
 */
export function StoreTabletCard({
  api,
  storeName,
  thisDevice,
  onUseAsTablet,
  onStopThisDevice,
}: {
  api: StaffClient;
  storeName: string;
  thisDevice: { id: string | null; name: string | null } | null;
  /** The device token is saved and the app goes to "Who's serving?". */
  onUseAsTablet: (res: StoreDeviceCreated) => Promise<void>;
  /** This tablet was revoked: forget it and go to sign-in. */
  onStopThisDevice: () => void;
}) {
  const [devices, setDevices] = useState<StoreDevice[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const [name, setName] = useState("Counter tablet");
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  const load = useCallback(async () => {
    setListErr(null);
    try {
      const r = await api.get<{ devices?: StoreDevice[] }>("/api/store-devices");
      setDevices(Array.isArray(r?.devices) ? r.devices : []);
    } catch (e) {
      setListErr(errText(e));
    }
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);

  async function enrol() {
    setActionErr(null);
    // A tablet whose key is gone after a reload would leave an enrolled tablet that nothing holds.
    if (!canKeepDevice()) {
      setActionErr("This browser can't keep the tablet's key after a reload. Turn off private browsing (and on an iPad, Settings › Safari › Block All Cookies), then try again.");
      return;
    }
    setEnrolling(true);
    try {
      const r = await api.post<StoreDeviceCreated>("/api/store-devices", { name: name.trim() });
      if (!r || typeof r.deviceToken !== "string" || !r.device?.id) throw new Error("The server didn't send the tablet's key. Try again.");
      await onUseAsTablet(r);
    } catch (e) {
      setActionErr(errText(e));
      setEnrolling(false);
    }
  }
  function confirmEnrol() {
    const problem = deviceNameProblem(name);
    setNameErr(problem);
    if (problem) return;
    Alert.alert(
      "Use this device as the store tablet?",
      `You'll be signed out here. From then on everyone at ${storeName} taps their name and types their PIN to use it.`,
      [
        { text: "Not now", style: "cancel" },
        { text: "Use as store tablet", onPress: () => void enrol() },
      ],
    );
  }

  async function revoke(id: string, after?: () => void) {
    setActionErr(null);
    setBusyId(id);
    try {
      await api.post(`/api/store-devices/${encodeURIComponent(id)}/revoke`);
      if (after) {
        after();
        return;
      }
      await load();
    } catch (e) {
      setActionErr(errText(e));
    } finally {
      setBusyId(null);
    }
  }
  function confirmRemove(d: StoreDevice) {
    Alert.alert(`Remove “${d.name}”?`, "It stops working straight away. A manager can set it up again from Settings on that device.", [
      { text: "Keep it", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void revoke(d.id) },
    ]);
  }
  function confirmStop() {
    Alert.alert("Stop using this device as the store tablet?", "Staff won't be able to pick their name here any more. This device goes back to the sign-in screen.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Stop using it",
        style: "destructive",
        onPress: () => {
          const id = thisDevice?.id;
          // Without its id (never read from the server) there's nothing to revoke — just forget it here.
          if (!id) onStopThisDevice();
          else void revoke(id, onStopThisDevice);
        },
      },
    ]);
  }

  // Working tablets first (newest first, as the server sends them), removed ones after.
  const list = devices ? [...devices.filter((d) => !d.revokedAt), ...devices.filter((d) => d.revokedAt)] : null;

  return (
    <Card style={{ gap: 12 }}>
      <H2>{thisDevice ? "Store tablets" : "Store tablet"}</H2>
      {thisDevice ? (
        <Body muted>{`This device is ${storeName}'s tablet${thisDevice.name ? ` (“${thisDevice.name}”)` : ""}. Staff tap their name and type their PIN. Remove a tablet that's lost or replaced — it stops working at once.`}</Body>
      ) : (
        <>
          <Body muted>Leave a tablet at the counter signed in for the store. Each advisor taps their name and types a 4-digit PIN — no password every day, and every trade-in still shows who did it.</Body>
          <Field
            label="Tablet name"
            value={name}
            onChangeText={setName}
            autoCapitalize="sentences"
            maxLength={40}
            error={nameErr}
            hint="So you can tell your tablets apart, like “Counter tablet 1”."
            editable={!enrolling}
          />
          <Btn title="Use this device as the store tablet" onPress={confirmEnrol} busy={enrolling} />
        </>
      )}

      {actionErr ? <Banner tone="bad" title="That didn't work">{actionErr}</Banner> : null}

      {listErr ? (
        <Banner tone="bad" title="Couldn't load the store's tablets" action={{ title: "Try again", onPress: load }}>
          {listErr}
        </Banner>
      ) : list === null ? (
        <Body muted>Loading…</Body>
      ) : list.length === 0 ? (
        thisDevice ? null : <Body muted>No store tablets yet.</Body>
      ) : (
        <View>
          {!thisDevice ? <Text style={{ color: L.muted, fontSize: 14, fontWeight: "700", marginTop: 4, marginBottom: 2 }}>TABLETS AT THIS STORE</Text> : null}
          {list.map((d) => (
            <DeviceRow
              key={d.id}
              d={d}
              mine={!!thisDevice?.id && d.id === thisDevice.id}
              busy={busyId === d.id}
              onRemove={() => confirmRemove(d)}
            />
          ))}
        </View>
      )}

      {thisDevice ? (
        <Btn
          title="Stop using this device as the store tablet"
          kind="danger"
          onPress={confirmStop}
          busy={!!thisDevice.id && busyId === thisDevice.id}
          style={{ marginTop: 4 }}
        />
      ) : null}
    </Card>
  );
}

function DeviceRow({ d, mine, busy, onRemove }: { d: StoreDevice; mine: boolean; busy: boolean; onRemove: () => void }) {
  const added = [day(d.createdAt) && `Added ${day(d.createdAt)}`, d.createdBy && `by ${d.createdBy}`].filter(Boolean).join(" ");
  const seen = d.revokedAt ? `removed ${day(d.revokedAt)}` : d.lastSeenAt ? `last used ${ago(d.lastSeenAt)}` : "not used yet";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: L.border, opacity: d.revokedAt ? 0.6 : 1 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={{ color: L.ink, fontSize: 17, fontWeight: "700" }} numberOfLines={1}>
          {d.name}
        </Text>
        <Text style={{ color: L.muted, fontSize: 14 }}>{[added, seen].filter(Boolean).join(" · ")}</Text>
      </View>
      {d.revokedAt ? (
        <Chip text="Removed" tone="muted" />
      ) : mine ? (
        <Chip text="This tablet" tone="up" />
      ) : (
        <Btn title="Remove" kind="danger" onPress={onRemove} busy={busy} />
      )}
    </View>
  );
}

/** Anyone signed in: set or change the PIN that unlocks the store tablet (POST /api/me/pin). */
export function ChangePin({ api }: { api: StaffClient }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setError(null);
    setSaved(false);
    if (!password) {
      setError("Type your SwapUp password — the one you sign in to the desk with.");
      return;
    }
    const problem = newPinProblem(pin, repeat);
    setPinErr(problem);
    if (problem) return;
    setBusy(true);
    try {
      await api.post("/api/me/pin", { password, pin });
      setPassword("");
      setPin("");
      setRepeat("");
      setOpen(false);
      setSaved(true);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 12 }}>
      <H2>My PIN</H2>
      <Body muted>Your 4-digit PIN unlocks the store tablet: tap your name, type the PIN.</Body>
      {saved ? <Banner tone="up" title="PIN saved. Use it on the store tablet from now on." /> : null}
      {open ? (
        <View style={{ gap: 16 }}>
          <Field
            label="Your SwapUp password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password"
            textContentType="password"
            editable={!busy}
          />
          <Field
            label="New PIN"
            value={pin}
            onChangeText={(v) => setPin(pinInput(v))}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={PIN_LENGTH}
            autoComplete="off"
            hint="4 digits. Not one digit four times, and not a run like 1234."
            error={pinErr}
            editable={!busy}
          />
          <Field
            label="Type the PIN again"
            value={repeat}
            onChangeText={(v) => setRepeat(pinInput(v))}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={PIN_LENGTH}
            autoComplete="off"
            returnKeyType="go"
            onSubmitEditing={save}
            editable={!busy}
          />
          {error ? <Banner tone="bad" title="Couldn't save your PIN">{error}</Banner> : null}
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Btn title="Save my PIN" onPress={save} busy={busy} />
            <Btn
              title="Cancel"
              kind="ghost"
              onPress={() => {
                setOpen(false);
                setPassword("");
                setPin("");
                setRepeat("");
                setPinErr(null);
                setError(null);
              }}
            />
          </View>
        </View>
      ) : (
        <Btn
          title="Change my PIN"
          kind="secondary"
          onPress={() => {
            setSaved(false);
            setOpen(true);
          }}
          style={{ alignSelf: "flex-start" }}
        />
      )}
    </Card>
  );
}
