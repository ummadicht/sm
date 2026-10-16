// Browser versions of the Bluetooth and NFC tests (the native app's
// ConfirmTest covers both ids, so this file does too).
//  - bluetooth: Web Bluetooth's getAvailability() — is there a Bluetooth radio
//    the browser can use? (Chrome on Android/desktop.) No Web Bluetooth
//    (iPhone Safari, Firefox, Brave) → the browser can't test it.
//  - nfc: Web NFC (NDEFReader, Chrome on Android) — scan, and any card or tag
//    the phone picks up proves the NFC reader works. A bank card is not an NFC
//    "tag", so Chrome reports it as a read error — that still means the reader
//    saw it. No Web NFC → can't test.
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { Result } from "../catalog";
import { Big, BigEmoji, Say } from "../parts";
import { CantTest } from "../web/WebParts";
import { bluetoothApi, errName, ndefReaderCtor } from "../web/browser";

export function ConfirmTest(p: TestProps) {
  if (p.test.id === "bluetooth") return <BluetoothWeb {...p} />;
  if (p.test.id === "nfc") return <NfcWeb {...p} />;
  return <CantTest p={p} reason="This test needs the app." />;
}

/* ───────────── Bluetooth ───────────── */

function BluetoothWeb(p: TestProps) {
  const bt = bluetoothApi();
  const [avail, setAvail] = useState<boolean | null>(null);
  const [checks, setChecks] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const check = () => {
    if (!bt?.getAvailability) return;
    setAvail(null);
    bt.getAvailability().then(
      (a) => {
        setAvail(a);
        setChecks((n) => n + 1);
      },
      (e) => {
        setErr(errName(e));
        setAvail(false);
        setChecks((n) => n + 1);
      }
    );
  };
  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!bt) return <CantTest p={p} reason="This browser has no access to Bluetooth." />;

  // Bluetooth simply being switched off is not a fault: one "not available"
  // asks the customer to turn it on; still unavailable after that → fail (they can override).
  const auto: Result | null = avail === true ? "pass" : avail === false && checks >= 2 ? "fail" : null;
  const detail = { method: "web-bluetooth getAvailability", available: avail, checks, error: err, runtime: "browser" };
  return (
    <TestShell {...p} instructions="Checks that the phone has a working Bluetooth radio the browser can use." autoVerdict={auto} detail={detail}>
      <View style={s.wrap}>
        <BigEmoji>{avail ? "✅" : "🟦"}</BigEmoji>
        {avail == null ? (
          <Say center>Checking Bluetooth…</Say>
        ) : avail ? (
          <Say center>Bluetooth radio found ✓</Say>
        ) : (
          <>
            <Say center>
              {checks >= 2
                ? "Bluetooth still isn't available. If it is switched on in Settings, the radio may be faulty."
                : "Bluetooth isn't available. Turn Bluetooth on (swipe down from the top of the screen), then tap Check again."}
            </Say>
            <Big title="Check again" onPress={check} />
          </>
        )}
      </View>
    </TestShell>
  );
}

/* ───────────── NFC ───────────── */

const SCAN_SECONDS = 30;
type NfcPhase = "idle" | "scanning" | "found" | "timeout" | "denied" | "off" | "error";

function NfcWeb(p: TestProps) {
  const Reader = ndefReaderCtor();
  const [phase, setPhase] = useState<NfcPhase>("idle");
  const [found, setFound] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [left, setLeft] = useState(SCAN_SECONDS);
  const ctrl = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const t0 = useRef(0);
  const done = useRef(false);

  const stop = () => {
    ctrl.current?.abort();
    ctrl.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => () => { done.current = true; stop(); }, []);

  if (!Reader) return <CantTest p={p} reason="This browser has no access to the phone's NFC reader." />;

  const detail = { method: "web-nfc", detected: found, error: err, runtime: "browser" };

  const hit = (kind: "nfc-tag" | "card") => {
    if (done.current) return;
    done.current = true;
    stop();
    setFound(kind);
    setPhase("found");
    const afterSec = Math.round((Date.now() - t0.current) / 1000);
    setTimeout(() => p.onResult("pass", { ...detail, detected: kind, afterSec }), 700);
  };

  const start = async () => {
    stop();
    setErr(null);
    setFound(null);
    const c = new AbortController();
    ctrl.current = c;
    try {
      const r = new Reader();
      r.onreading = () => hit("nfc-tag");
      r.onreadingerror = () => hit("card"); // something was tapped but isn't an NFC tag (e.g. a bank card)
      await r.scan({ signal: c.signal }); // needs the tap that called start()
    } catch (e) {
      if (c.signal.aborted) return;
      const n = errName(e);
      setErr(n);
      setPhase(n === "NotAllowedError" ? "denied" : n === "NotReadableError" ? "off" : "error");
      return;
    }
    t0.current = Date.now();
    setLeft(SCAN_SECONDS);
    setPhase("scanning");
    timer.current = setInterval(() => {
      const l = SCAN_SECONDS - Math.round((Date.now() - t0.current) / 1000);
      setLeft(Math.max(0, l));
      if (l <= 0) {
        stop();
        setPhase("timeout");
      }
    }, 500);
  };

  if (phase === "error" && err === "NotSupportedError") {
    return <CantTest p={p} reason="The browser can't reach an NFC reader on this phone." detail={{ error: err }} />;
  }

  const auto: Result | null = phase === "found" ? "pass" : phase === "denied" ? "skip" : null;
  return (
    <TestShell {...p} instructions="Tap Start, then hold any contactless card (bank, metro, ID) or NFC tag flat against the back of the phone, near the top." autoVerdict={auto} detail={detail}>
      <View style={s.wrap}>
        <BigEmoji>{phase === "found" ? "✅" : "💳"}</BigEmoji>
        {phase === "scanning" ? (
          <>
            <Say center>Hold the card against the back of the phone now… {left}s</Say>
            <Big title="Stop" kind="quiet" onPress={() => { stop(); setPhase("idle"); }} />
          </>
        ) : phase === "found" ? (
          <Say center>Card detected — NFC works ✓</Say>
        ) : (
          <>
            {phase === "timeout" ? <Say center>Nothing detected in {SCAN_SECONDS} s. Move the card around the back of the phone and try again — or press Fail.</Say> : null}
            {phase === "denied" ? <Say center>NFC was blocked for this page. Allow it (tap the lock next to the address), then try again — or skip.</Say> : null}
            {phase === "off" ? <Say center>NFC looks switched off. Turn it on in Settings → Connected devices → NFC, then try again.</Say> : null}
            {phase === "error" ? <Say center>NFC wouldn't start{err ? ` (${err})` : ""}. Try again.</Say> : null}
            <Big title={phase === "idle" ? "Start" : "Try again"} onPress={start} />
          </>
        )}
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center", gap: 16 } });
