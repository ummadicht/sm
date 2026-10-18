// Browser version of "feel the buzz": navigator.vibrate (Chrome on Android)
// from the customer's tap, then the customer says whether they felt it.
// iPhone Safari has no vibration API, and a browser that refuses every buzz
// can't run the test either → "unsupported". The Yes/No question only appears
// once the browser has actually accepted a buzz, so nobody can pass a phone
// that was never asked to vibrate.
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { Big, BigEmoji, Say } from "../parts";
import { CantBody, CantTest } from "../web/WebParts";

function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function VibrationTest(p: TestProps) {
  const [tries, setTries] = useState(0);
  const [accepted, setAccepted] = useState(0);
  if (!canVibrate()) return <CantTest p={p} reason="This browser can't make the phone vibrate." />;

  const buzz = () => {
    let ok = false;
    try {
      ok = navigator.vibrate([400, 150, 400]); // two strong pulses, like the app
    } catch {
      ok = false;
    }
    setTries((x) => x + 1);
    if (ok) setAccepted((x) => x + 1);
  };
  const detail = { triggered: tries, browserAccepted: accepted, method: "navigator.vibrate", runtime: "browser" };

  if (tries >= 2 && accepted === 0) {
    const reason = "This browser refused to make the phone vibrate.";
    return (
      <TestShell {...p} instructions={reason} autoVerdict="unsupported" hideManual detail={{ ...detail, reason }}>
        <CantBody emoji={p.test.emoji} />
      </TestShell>
    );
  }
  return (
    <TestShell {...p} instructions="Hold it loosely and tap Buzz." hideManual detail={detail}>
      <View style={s.wrap}>
        <BigEmoji>📳</BigEmoji>
        <Big title={tries ? "Buzz again" : "Buzz"} onPress={buzz} />
        {tries > 0 && accepted === 0 ? (
          <Say muted center style={{ fontSize: 15 }}>No buzz started — tap Buzz again.</Say>
        ) : null}
        {accepted > 0 ? (
          <>
            <Say center>Did you feel two buzzes?</Say>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Big title="No" kind="fail" onPress={() => p.onResult("fail", detail)} style={{ flex: 1 }} />
              <Big title="Yes" kind="pass" onPress={() => p.onResult("pass", detail)} style={{ flex: 1.4 }} />
            </View>
          </>
        ) : null}
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center", gap: 18 } });
