// Settings → Counter QR (docs/PHONE-LED-FLOW.md, "Both can start a trade-in"): the
// store's permanent code for the counter. A customer scans it with their own phone
// and starts a trade-in alone; the session is the store's, so it lands on Home under
// Open tests like any other.
//   GET  /api/stores/counter-code             advisor or manager of this store; made on first read
//   POST /api/stores/counter-code/regenerate  manager only — the old printout stops working
// A server from before counter codes answers 404: the card says so and nothing else changes.
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { ApiError } from "../../shared/api";
import { L } from "../../shared/theme";
import { QR } from "../QR";
import { readCounterCode } from "../phoneLed";
import { PRINT_HINT, PRINT_LABEL, printCounterQr } from "../printPoster";
import { StaffClient, absolute, errText } from "../staffClient";
import { Banner, Body, Btn, Card, H2 } from "../ui";

type Code = { code: string; joinUrl: string };

export function CounterQrCard({ api, storeName, canManage }: { api: StaffClient; storeName: string; canManage: boolean }) {
  /** undefined = loading; null = this server has no counter codes. */
  const [code, setCode] = useState<Code | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"new" | "print" | null>(null);
  const [actionErr, setActionErr] = useState<{ title: string; text: string } | null>(null);
  const [renewed, setRenewed] = useState(false);

  const take = useCallback(
    (r: unknown): Code => {
      const c = readCounterCode(r);
      if (!c) throw new Error("The server's answer about the counter code didn't make sense. Try again.");
      return { code: c.code, joinUrl: absolute(api.base, c.joinUrl ?? `/j/${c.code}`) };
    },
    [api.base]
  );

  const load = useCallback(async () => {
    setErr(null);
    try {
      setCode(take(await api.get<unknown>("/api/stores/counter-code")));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setCode(null);
      else setErr(errText(e));
    }
  }, [api, take]);
  useEffect(() => {
    load();
  }, [load]);

  async function regenerate() {
    setActionErr(null);
    setBusy("new");
    try {
      setCode(take(await api.post<unknown>("/api/stores/counter-code/regenerate")));
      setRenewed(true);
    } catch (e) {
      setActionErr({ title: "No new code", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  function confirmRegenerate() {
    Alert.alert(
      "Make a new counter code?",
      "The printed QR and the old code stop starting new checks straight away (checks already running carry on). Print the new one and swap it at the counter.",
      [
        { text: "Keep this code", style: "cancel" },
        { text: "Make a new code", style: "destructive", onPress: regenerate },
      ]
    );
  }

  // No await before printCounterQr: in the browser it opens the print tab first thing,
  // and a popup blocker only allows that straight from the tap.
  async function print() {
    if (!code) return;
    setActionErr(null);
    setBusy("print");
    const r = await printCounterQr({ storeName, code: code.code, joinUrl: code.joinUrl });
    setBusy(null);
    if (!r.ok) setActionErr({ title: "Couldn't print the counter QR", text: r.error });
  }

  return (
    <Card>
      <H2>Counter QR</H2>
      <Body muted>
        Customers can start a trade-in on their own: they scan this with their phone's camera, and their check appears on Home under Open tests. Print it for the
        counter.
      </Body>
      {renewed ? (
        <Banner tone="up" title="New code made">
          The old printout no longer starts new checks. Print this one and swap it at the counter.
        </Banner>
      ) : null}
      {code === undefined ? (
        err ? (
          <Banner tone="bad" title="Couldn't load the counter QR" action={{ title: "Try again", onPress: load }}>
            {err}
          </Banner>
        ) : (
          <Body muted>Loading…</Body>
        )
      ) : code === null ? (
        <Banner tone="muted" title="Not on this server yet">
          This SwapUp server doesn't have counter QR codes yet. Start trade-ins from Home as usual.
        </Banner>
      ) : (
        <View style={{ alignItems: "center", gap: 8 }}>
          <QR value={code.joinUrl} size={220} />
          <Text
            style={{ fontSize: 40, fontWeight: "900", letterSpacing: 8, color: L.ink, fontVariant: ["tabular-nums"], textAlign: "center" }}
            selectable
            accessibilityLabel={`Code ${code.code.split("").join(" ")}`}
          >
            {code.code}
          </Text>
          <Text style={{ color: L.muted, fontSize: 14, textAlign: "center" }} selectable>
            {code.joinUrl}
          </Text>
        </View>
      )}
      {code ? (
        canManage ? (
          <View style={{ gap: 8 }}>
            <Btn title={PRINT_LABEL} onPress={print} busy={busy === "print"} disabled={!!busy && busy !== "print"} />
            <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>{PRINT_HINT}</Text>
            <Btn title="New code" kind="secondary" onPress={confirmRegenerate} busy={busy === "new"} disabled={!!busy && busy !== "new"} style={{ marginTop: 6 }} />
            <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>Only if the printout is lost or misused — the old code stops starting new checks.</Text>
          </View>
        ) : (
          <Body muted>Only a store manager can print it or make a new code.</Body>
        )
      ) : null}
      {actionErr ? <Banner tone="bad" title={actionErr.title}>{actionErr.text}</Banner> : null}
    </Card>
  );
}
