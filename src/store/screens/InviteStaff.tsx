// A store manager invites staff from the app: an 8-character code (and a QR that
// opens the store app's sign-up with it filled in). Codes work for 7 days, 5 people.
import React, { useState } from "react";
import { Text, View } from "react-native";
import { L } from "../../shared/theme";
import { QR } from "../QR";
import { errText, type StaffClient } from "../staffClient";
import { Banner, Body, Btn, Card, H2 } from "../ui";

type Created = { code: string; role: string; expiresAt: string; maxUses: number; url: string; deepLink: string };

export function InviteStaff({ api, storeId, storeName }: { api: StaffClient; storeId: string; storeName: string }) {
  const [created, setCreated] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const c = await api.post<Created>(`/api/stores/${encodeURIComponent(storeId)}/invites`, { days: 7, uses: 5 });
      // The browser link works on any phone; the Android app also opens it.
      const url = /^https?:\/\//.test(c.url) ? c.url : `${api.base}${c.url}`;
      setCreated({ ...c, url });
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 12 }}>
      <H2>Invite staff</H2>
      <Body muted>{`New advisors sign themselves up for ${storeName} with a code — they pick their own username and password.`}</Body>
      {created ? (
        <View style={{ alignItems: "center", gap: 8, paddingVertical: 6 }}>
          <QR value={created.url} size={180} />
          <Text selectable style={{ fontSize: 34, fontWeight: "900", letterSpacing: 6, color: L.ink }}>
            {created.code}
          </Text>
          <Body muted style={{ textAlign: "center" }}>
            {`Scan the QR, or open SwapUp Store → "Join my store with an invite code". Valid until ${new Date(created.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} for up to ${created.maxUses} people.`}
          </Body>
        </View>
      ) : null}
      {err ? <Banner tone="bad" title="Couldn't create an invite">{err}</Banner> : null}
      <Btn title={created ? "Create another code" : "Create an invite code"} onPress={create} busy={busy} kind={created ? "secondary" : "primary"} />
    </Card>
  );
}
