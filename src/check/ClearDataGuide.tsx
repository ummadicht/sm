// "Clear your phone" — shown once the store has the test results. The customer
// clears their own phone from its own Settings; this screen only explains the
// steps and opens Settings. Nothing here resets anything. Look: a white card on
// the result screen; the steps open in a bottom sheet.
import React, { useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { P } from "../shared/theme";
import { Arrow, Caption, PillButton, Sheet } from "../shared/kit";

const STEPS: { title: string; body: string }[] = [
  { title: "Back up", body: "Smart Switch or the cloud — nothing survives the reset." },
  {
    title: "Sign out of accounts",
    body: "Settings → Accounts and backup → Manage accounts → Samsung account → Sign out; then Google → Remove. (Others: Settings → Passwords & accounts.)",
  },
  {
    title: "Factory reset",
    body: "Settings → General management → Reset → Factory data reset. (Others: Settings → System → Reset options → Erase all data.)",
  },
  { title: "Show the advisor", body: "The advisor checks it restarts without asking for your account." },
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

  if (!applied) return <Caption style={{ marginTop: 14 }}>Don&apos;t reset it yet — the advisor needs these results.</Caption>;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [s.card, pressed && { backgroundColor: P.surface2 }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle}>Trading it in? Clear your phone</Text>
          <Text style={s.cardSub}>The advisor never needs your passwords.</Text>
        </View>
        <Arrow color={P.ink} />
      </Pressable>
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Clear your phone"
        lead="After you agree the trade-in. The advisor never needs your passwords."
        footer={<PillButton title="Done" onPress={() => setOpen(false)} />}
      >
        <View style={{ marginTop: 18, gap: 14 }}>
          {STEPS.map((step, i) => (
            <View key={step.title} style={s.step}>
              <View style={s.num}>
                <Text style={s.numText}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.stepTitle}>{step.title}</Text>
                <Text style={s.stepBody}>{step.body}</Text>
              </View>
            </View>
          ))}
          {android ? (
            <View style={{ gap: 10, marginTop: 4 }}>
              <PillButton
                title="Open Accounts"
                kind="outline"
                arrow={false}
                onPress={() => void openSettings("android.settings.SYNC_SETTINGS").then((ok) => setFailed(!ok))}
              />
              <PillButton title="Open Settings" kind="outline" arrow={false} onPress={() => void openSettings("android.settings.SETTINGS").then((ok) => setFailed(!ok))} />
              {failed ? <Caption>Open Settings from your home screen.</Caption> : null}
            </View>
          ) : null}
          <Caption center={false}>Resetting removes this app — your results are safe.</Caption>
        </View>
      </Sheet>
    </>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 18, flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: P.surface, borderRadius: P.radius, paddingVertical: 18, paddingHorizontal: 20 },
  cardTitle: { color: P.ink, fontSize: 17, fontWeight: "700" },
  cardSub: { color: P.muted, fontSize: 14, lineHeight: 20, marginTop: 4 },
  step: { flexDirection: "row", gap: 12 },
  num: { width: 28, height: 28, borderRadius: 14, backgroundColor: P.tint, alignItems: "center", justifyContent: "center", marginTop: 1 },
  numText: { color: P.ink, fontSize: 14, fontWeight: "700" },
  stepTitle: { color: P.ink, fontSize: 16, fontWeight: "700" },
  stepBody: { color: P.muted, fontSize: 15, lineHeight: 21, marginTop: 2 },
});
