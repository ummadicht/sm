// "Clear your phone" — shown once the store has the test results. The customer
// clears their own phone from its own Settings; this screen only explains the
// steps and opens Settings. Nothing here resets anything.
import React, { useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import { T } from "../shared/theme";
import { Big, Say } from "../diagnostics/parts";

const STEPS: { title: string; body: string }[] = [
  { title: "Back up", body: "Move photos and chats to your new phone (Smart Switch) or the cloud. After the reset nothing on this phone can be recovered." },
  {
    title: "Sign out of your accounts",
    body: "Settings → Accounts and backup → Manage accounts → your Samsung account → Sign out. Then your Google account → Remove account. (Other phones: Settings → Passwords & accounts.)",
  },
  {
    title: "Factory reset",
    body: "Settings → General management → Reset → Factory data reset → Reset. (Other phones: Settings → System → Reset options → Erase all data.)",
  },
  { title: "Show the advisor", body: "The phone restarts to a Welcome screen. The advisor checks it doesn't ask for your account." },
];

/** Android only: open a system Settings screen. Anything else just shows the steps. */
async function openSettings(action: string): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    await Linking.sendIntent(action);
    return true;
  } catch {
    try {
      await Linking.sendIntent("android.settings.SETTINGS");
      return true;
    } catch {
      return false;
    }
  }
}

export function ClearDataGuide({ applied }: { applied: boolean }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const android = Platform.OS === "android";

  if (!applied)
    return (
      <View style={{ marginTop: 14 }}>
        <Say muted center>
          Trading this phone in? Don&apos;t reset it yet — the advisor still needs these results.
        </Say>
      </View>
    );

  return (
    <View style={{ marginTop: 18, backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.border, padding: 16 }}>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={{ color: T.text, fontSize: 19, fontWeight: "800" }}>Trading it in? Clear your phone {open ? "▾" : "›"}</Text>
        <Text style={{ color: T.muted, fontSize: 15, marginTop: 4 }}>
          Once you&apos;ve agreed the trade-in, you clear it yourself — the advisor never needs your passwords.
        </Text>
      </Pressable>
      {open ? (
        <View style={{ marginTop: 12, gap: 12 }}>
          {STEPS.map((s, i) => (
            <View key={s.title}>
              <Text style={{ color: T.text, fontSize: 16, fontWeight: "700" }}>
                {i + 1}. {s.title}
              </Text>
              <Text style={{ color: T.muted, fontSize: 15, marginTop: 2, lineHeight: 21 }}>{s.body}</Text>
            </View>
          ))}
          {android ? (
            <>
              <Big
                title="Open Accounts"
                kind="secondary"
                onPress={() => void openSettings("android.settings.SYNC_SETTINGS").then((ok) => setFailed(!ok))}
              />
              <Big title="Open Settings" kind="secondary" onPress={() => void openSettings("android.settings.SETTINGS").then((ok) => setFailed(!ok))} />
              {failed ? <Say muted>Couldn&apos;t open Settings — open it from your home screen.</Say> : null}
            </>
          ) : null}
          <Say muted>Resetting also removes this app. That&apos;s expected — your results are already with the store.</Say>
        </View>
      ) : null}
    </View>
  );
}
